/**
 * 輕量 2D 追蹤器（規格 6／12）：
 * - 間歇語意辨識之間以 IoU 匹配＋位置/速度平滑維持 Sticker 不跳動。
 * - 短暫遮擋／離開畫面：先進入 fading（淡出），超過時限或確認離開視野即移除（決策 2）。
 *   不沿用過時位置宣稱有效；淡出過程標記為不可點擊。
 * - 依效能等級限制同時追蹤數（超出者保留分數最高者）。
 */

export type TrackSource = "model" | "geo";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  kind: string;
  /** 0–1 */
  score: number;
  /** 可見區正規化座標 */
  box: Box;
  source: TrackSource;
}

export type TrackState = "active" | "fading" | "gone";

export interface Track {
  id: number;
  kind: string;
  source: TrackSource;
  /** 平滑後的分數（0–1） */
  score: number;
  /** 平滑後的位置（正規化座標） */
  box: Box;
  /** 速度（正規化座標／秒） */
  vel: { vx: number; vy: number };
  state: TrackState;
  /** 連續未匹配到的偵測次數 */
  missed: number;
  /** 首次出現時間（ms） */
  firstTs: number;
  /** 最後匹配時間（ms） */
  lastTs: number;
  /** 使用者拖曳的錨點偏移（正規化座標），供「修正位置」 */
  userOffset: { dx: number; dy: number };
  /** 幾何候選是否已被使用者確認類別 */
  confirmed: boolean;
  /** 幾何候選：使用者是否否決（true 後不再顯示） */
  rejected: boolean;
}

export interface TrackerOptions {
  /** 淡出時長（ms） */
  fadeMs?: number;
  /** 連續幾次未匹配後移除（配合 fadeMs） */
  maxMissed?: number;
  /** IoU 匹配門檻 */
  iouThreshold?: number;
  /** 位置平滑係數（新值權重） */
  posAlpha?: number;
  /** 尺寸平滑係數 */
  sizeAlpha?: number;
}

export const DEFAULT_TRACKER_OPTIONS: Required<TrackerOptions> = {
  fadeMs: 500,
  maxMissed: 3,
  iouThreshold: 0.2,
  posAlpha: 0.55,
  sizeAlpha: 0.4,
};

let nextId = 1;

export function resetTrackerIds(): void {
  nextId = 1;
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function boxCenter(b: Box): { cx: number; cy: number } {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

export class Tracker {
  tracks: Track[] = [];
  private opts: Required<TrackerOptions>;

  constructor(opts: TrackerOptions = {}) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...opts };
  }

  reset(): void {
    this.tracks = [];
  }

  /** 幾何候選確認／否決後更新類別或移除 */
  confirm(id: number, kind: string): void {
    const t = this.tracks.find((x) => x.id === id);
    if (t) {
      t.kind = kind;
      t.confirmed = true;
    }
  }

  reject(id: number): void {
    const t = this.tracks.find((x) => x.id === id);
    if (t) t.rejected = true;
  }

  /** 使用者拖曳位置（正規化位移） */
  nudge(id: number, dx: number, dy: number): void {
    const t = this.tracks.find((x) => x.id === id);
    if (t) {
      t.userOffset.dx += dx;
      t.userOffset.dy += dy;
    }
  }

  /**
   * 以新偵測更新追蹤。dtMs 為兩次更新間隔（供速度估計）。
   * maxTracks：同時存在的活躍追蹤上限（效能等級）。
   */
  update(dets: Detection[], ts: number, dtMs: number, maxTracks = 6): Track[] {
    const dt = Math.max(0, Math.min(2000, dtMs)) / 1000;

    // 1) 移除被否決／逾時／fading 超時的追蹤
    this.tracks = this.tracks.filter(
      (t) =>
        !t.rejected &&
        !(t.state === "gone") &&
        !(t.missed >= this.opts.maxMissed && ts - t.lastTs > this.opts.fadeMs),
    );

    // 2) 貪心匹配：依偵測分數排序，與 IoU 最大且過門檻的追蹤配對
    const used = new Set<number>();
    const sortedDets = [...dets].sort((a, b) => b.score - a.score);
    const matchedDets = new Set<Detection>();
    for (const d of sortedDets) {
      let best: Track | null = null;
      let bestIou = 0;
      for (const t of this.tracks) {
        if (used.has(t.id)) continue;
        const v = iou(t.box, d.box);
        if (v >= this.opts.iouThreshold && v > bestIou) {
          best = t;
          bestIou = v;
        }
      }
      if (best) {
        used.add(best.id);
        matchedDets.add(d);
        this.applyMatch(best, d, dt, ts);
      }
    }

    // 3) 未匹配偵測 → 新追蹤（不超過 maxTracks；優先分數高者）
    const activeCount = () => this.tracks.filter((t) => t.state !== "gone").length;
    for (const d of sortedDets) {
      if (matchedDets.has(d)) continue;
      if (activeCount() >= maxTracks) break;
      const c = boxCenter(d.box);
      const fresh: Track = {
        id: nextId++,
        kind: d.kind,
        source: d.source,
        score: d.score,
        box: { ...d.box },
        vel: { vx: 0, vy: 0 },
        state: "active",
        missed: 0,
        firstTs: ts,
        lastTs: ts,
        userOffset: { dx: 0, dy: 0 },
        confirmed: d.source === "model",
        rejected: false,
        ...(c ? {} : {}),
      };
      this.tracks.push(fresh);
      used.add(fresh.id); // 本輪新建的追蹤已「匹配到」當前偵測，不可立刻被標為 missed
    }

    // 4) 未匹配追蹤 → missed++ / fading；超出上限時淘汰分數最低者
    for (const t of this.tracks) {
      if (used.has(t.id)) continue;
      t.missed++;
      if (t.state === "active") t.state = "fading";
      if (t.missed >= this.opts.maxMissed || ts - t.lastTs > this.opts.fadeMs + 400) t.state = "gone";
    }
    let active = this.tracks.filter((t) => t.state !== "gone");
    while (active.length > maxTracks) {
      let worst: Track | null = null;
      for (const t of active) {
        if (used.has(t.id)) continue; // 剛匹配到的不淘汰
        if (!worst || t.score < worst.score) worst = t;
      }
      if (!worst) break;
      worst.state = "gone";
      active = active.filter((t) => t !== worst);
    }

    this.tracks = this.tracks.filter((t) => t.state !== "gone");
    return this.tracks;
  }

  private applyMatch(t: Track, d: Detection, dt: number, ts: number): void {
    const prev = boxCenter(t.box);
    const t0 = t.lastTs;
    // 平滑
    t.box.x += (d.box.x - t.box.x) * this.opts.posAlpha;
    t.box.y += (d.box.y - t.box.y) * this.opts.posAlpha;
    t.box.w += (d.box.w - t.box.w) * this.opts.sizeAlpha;
    t.box.h += (d.box.h - t.box.h) * this.opts.sizeAlpha;
    t.score += (d.score - t.score) * 0.4;
    // 速度（EMA）
    const cur = boxCenter(t.box);
    const vx = (cur.cx - prev.cx) / Math.max(0.001, dt);
    const vy = (cur.cy - prev.cy) / Math.max(0.001, dt);
    const velAlpha = 0.3;
    t.vel.vx += (vx - t.vel.vx) * velAlpha;
    t.vel.vy += (vy - t.vel.vy) * velAlpha;
    // 類別不變性：模型來源一致時才換類別（幾何候選由確認流程改）
    if (t.source === d.source && t.kind !== d.kind && t.source === "model" && d.source === "model") {
      // 少見；保守沿用舊類別，避免閃換
    }
    t.missed = 0;
    t.state = "active";
    t.lastTs = ts;
    void t0;
  }

  /** 是否有指定 id 的活躍（非 gone、未否決）追蹤 */
  find(id: number): Track | undefined {
    return this.tracks.find((t) => t.id === id && !t.rejected);
  }
}
