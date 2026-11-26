/**
 * AR pipeline（規格 3 分層 2–6 的串接）：
 *   Camera → Detection（模型＋幾何候選） → Tracking → Spatial Interpretation → Feng Shui → Rendering
 *
 * 設計重點：
 * - 相機優先（規格 5.4／決策 23B）：啟動即開鏡頭；模型背景分階段載入，未就緒前只顯示實景＋方位。
 * - 辨識為間歇 tick（PerfGovernor 控制頻率/解析度/上限）；追蹤與渲染以 rAF 平滑（決策 12B）。
 * - 不跨次儲存空間錨點（決策 21A）：每次進 AR 重新辨識。
 * - 物件離開畫面 → 淡出移除（決策 2B）；過時位置不宣稱有效（規格 12）。
 */

import { createCameraManager, type CameraManager, type CameraState } from "../camera/cameraManager";
import { computeCoverCrop } from "../camera/coverCrop";
import { Tracker, type Track, type Detection } from "../tracking/tracker";
import { PerfGovernor } from "./perf";
import { interpret, statusText, type SpatialContext } from "./spatial";
import { planLayout, cardHeightPx, type StickerPlan } from "./stickerLayout";
import { StickerRenderer, type StickerView, type StickerTone } from "./stickerRenderer";
import { detectOnCanvas, getDetectorState, loadDetector, type DetectorState } from "../vision/detector";
import { detectQuadCandidates } from "../vision/geometric";
import { ModelRegistry, type ModelState } from "../vision/modelRegistry";
import { defOf, type ObjectKind } from "../vision/labels";
import { STARS, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { STAR_SHORT } from "../app/starText";
import type { Quality } from "../domain/compass/heading";

export interface PipelineStatus {
  camState: CameraState;
  camRunning: boolean;
  detector: DetectorState;
  model: ModelState;
  perfLevel: number;
  trackCount: number;
  fps: number | null;
  inferenceMs: number | null;
}

export interface PhotoSticker {
  box: { x: number; y: number; w: number; h: number };
  tone: StickerTone;
  title: string;
  sub: string;
  status: string;
}

export interface ARPipelineCallbacks {
  onStatus: (s: PipelineStatus) => void;
  onTapTrack: (trackId: number) => void;
  onCamEnded?: () => void;
}

interface Suppression {
  box: { x: number; y: number; w: number; h: number };
  until: number;
}

function rectIou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
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

export class ARPipeline {
  private host: HTMLElement;
  private cb: ARPipelineCallbacks;
  cam: CameraManager;
  registry = new ModelRegistry();
  private tracker = new Tracker();
  private governor = new PerfGovernor();
  private renderer: StickerRenderer | null = null;

  private ctx: SpatialContext = {
    headingDeg: null,
    quality: "unavailable",
    tiltDegraded: false,
    homeAtCenter: false,
    wheel: null,
  };

  private layerW = 1;
  private layerH = 1;
  private inputCanvas: HTMLCanvasElement | null = null;
  private rafId = 0;
  private detectTimer: number | null = null;
  private lastDetTs = 0;
  private detectCount = 0;
  private busy = false;
  private suppressed: Suppression[] = [];
  private frameDts: number[] = [];
  private lastFrameTs = 0;
  private fpsMedian: number | null = null;
  private lastInferenceMs: number | null = null;
  private statusTimer: number | null = null;
  private stopped = false;

  constructor(host: HTMLElement, cb: ARPipelineCallbacks) {
    this.host = host;
    this.cb = cb;
    this.cam = createCameraManager();
    this.cam.onEnded = () => {
      this.emitStatus();
      this.cb.onCamEnded?.();
    };
    this.renderer = new StickerRenderer(host, {
      onTap: (id) => this.cb.onTapTrack(id),
      onDrag: (id, dx, dy) => this.tracker.nudge(id, dx, dy),
    });
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  dispose(): void {
    this.stopped = true;
    window.removeEventListener("resize", this.resize);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.detectTimer !== null) window.clearTimeout(this.detectTimer);
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    this.cam.stop();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private resize = (): void => {
    const r = this.host.getBoundingClientRect();
    this.layerW = Math.max(1, r.width);
    this.layerH = Math.max(1, r.height);
  };

  setSpatialContext(ctx: SpatialContext): void {
    this.ctx = ctx;
  }

  /** 相機（由 React 依權限與可見性呼叫） */
  async startCamera(retry = true): Promise<boolean> {
    const video = this.cam.video;
    if (!video) return false;
    video.className = "scene-video";
    const mediaHost = this.host.querySelector(".scene-media");
    if (mediaHost && !video.parentElement) mediaHost.prepend(video);
    try {
      const ok = await this.cam.start();
      this.emitStatus();
      return ok;
    } catch (err) {
      const name = (err as DOMException)?.name ?? "";
      if (retry && (name === "NotReadableError" || name === "AbortError")) {
        await new Promise((r) => setTimeout(r, 700));
        return this.startCamera(false);
      }
      this.emitStatus();
      throw err;
    }
  }

  stopCamera(): void {
    this.cam.stop();
    this.emitStatus();
  }

  /** 模型背景載入（規格 5.4：只顯示低干擾就緒提示） */
  async ensureModel(): Promise<boolean> {
    const okAssets = await this.registry.ensureReady();
    if (!okAssets) {
      this.emitStatus();
      return false;
    }
    const ok = await loadDetector();
    this.emitStatus();
    return ok;
  }

  /** 啟動主循環（相機與模型可後到位） */
  run(): void {
    this.stopped = false;
    if (this.statusTimer === null) {
      this.statusTimer = window.setInterval(() => this.emitStatus(), 700);
    }
    if (!this.rafId) this.rafId = requestAnimationFrame(this.frame);
    if (this.detectTimer === null) this.scheduleDetect(400);
  }

  pause(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.detectTimer !== null) window.clearTimeout(this.detectTimer);
    this.detectTimer = null;
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    this.statusTimer = null;
  }

  /* ---------- 使用者修正（決策 8） ---------- */

  confirmTrack(id: number, kind: ObjectKind): void {
    this.tracker.confirm(id, kind);
    this.suppressed = this.suppressed.filter((s) => !this.matchesTrack(s, id));
  }

  rejectTrack(id: number): void {
    const t = this.tracker.find(id);
    if (t) this.suppressed.push({ box: { ...t.box }, until: Date.now() + 60000 });
    this.tracker.reject(id);
  }

  private matchesTrack(s: Suppression, id: number): boolean {
    const t = this.tracker.find(id);
    return !!t && rectIou(s.box, t.box) > 0.4;
  }

  /* ---------- 主循環 ---------- */

  private scheduleDetect(delay: number): void {
    if (this.stopped) return;
    this.detectTimer = window.setTimeout(() => {
      this.detectTimer = null;
      void this.detectTick().finally(() => {
        this.scheduleDetect(this.governor.config.detectIntervalMs);
      });
    }, delay);
  }

  private detectTick(): Promise<void> {
    if (this.busy || this.stopped) return Promise.resolve();
    if (document.hidden || this.cam.state !== "running") return Promise.resolve();
    if (getDetectorState() !== "ready") return Promise.resolve();
    this.busy = true;
    const t0 = performance.now();
    return (async () => {
      try {
        const dets = await this.grabDetections();
        const ts = performance.now();
        const dt = Math.max(50, ts - (this.lastDetTs || ts - 1000));
        this.lastDetTs = ts;
        this.lastInferenceMs = performance.now() - t0;
        this.tracker.update(dets, ts, dt, this.governor.config.maxTracks);
        const changed = this.governor.record({ inferenceMs: this.lastInferenceMs, fpsMedian: this.fpsMedian });
        void changed;
        this.detectCount++;
      } finally {
        this.busy = false;
      }
    })();
  }

  private async grabDetections(): Promise<Detection[]> {
    const video = this.cam.video;
    if (!video || !video.videoWidth || !video.videoHeight) return [];
    const cfg = this.governor.config;
    const crop = computeCoverCrop(video.videoWidth, video.videoHeight, this.layerW, this.layerH);
    const iw = cfg.inputWidth;
    const ih = Math.max(48, Math.round((iw * crop.sh) / crop.sw));
    let canvas = this.inputCanvas;
    if (!canvas || canvas.width !== iw || canvas.height !== ih) {
      canvas = this.inputCanvas = document.createElement("canvas");
      canvas.width = iw;
      canvas.height = ih;
    }
    const cctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!cctx) return [];
    cctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, iw, ih);

    const modelDets = await detectOnCanvas(canvas, { maxBoxes: 10, minScore: 0.35 });

    // 幾何候選（門／窗）：每 N 次語意辨識跑一次（低成本）
    let geoDets: Detection[] = [];
    if (this.detectCount % cfg.geometricEvery === 0) {
      const cands = detectQuadCandidates(canvas, 2);
      geoDets = cands.map((c) => ({
        kind: "door",
        score: c.score * 0.8, // 幾何候選分數打折：僅為待確認提示
        box: c.box,
        source: "geo" as const,
      }));
    }

    const now = Date.now();
    this.suppressed = this.suppressed.filter((s) => s.until > now);
    const all = [...modelDets, ...geoDets].filter(
      (d) => !this.suppressed.some((s) => rectIou(s.box, d.box) > 0.45),
    );
    return all;
  }

  private frame = (ts: number): void => {
    if (this.stopped) return;
    this.rafId = requestAnimationFrame(this.frame);

    // fps 取樣
    if (this.lastFrameTs > 0) {
      const dt = ts - this.lastFrameTs;
      this.frameDts.push(dt);
      if (this.frameDts.length > 30) this.frameDts.shift();
      this.computeFps();
    }
    this.lastFrameTs = ts;

    const tracks = this.tracker.tracks;
    const views: StickerView[] = [];
    const plans = new Map<number, StickerPlan>();
    if (tracks.length > 0 && this.renderer) {
      const inputs = tracks.map((t) => {
        const cx = t.box.x + t.box.w / 2;
        const spatial = interpret(
          {
            headingDeg: this.ctx.headingDeg,
            quality: this.ctx.quality,
            tiltDegraded: this.ctx.tiltDegraded,
            homeAtCenter: this.ctx.homeAtCenter,
            boxCenterXNorm: cx,
            confirmed: t.source === "model" || t.confirmed,
          },
          this.ctx.wheel,
        );
        return { track: t, spatial, areaFrac: t.box.w * t.box.h };
      });
      const layout = planLayout(inputs, this.layerW, this.layerH, 4);
      for (const p of layout) plans.set(p.trackId, p);
      for (const i of inputs) {
        views.push(this.buildView(i.track, i.spatial, plans.get(i.track.id)));
      }
    }
    this.renderer?.sync(views, plans);
  };

  private buildView(t: Track, spatial: ReturnType<typeof interpret>, plan: StickerPlan | undefined): StickerView {
    const needsConfirm = t.source === "geo" && !t.confirmed;
    let tone: StickerTone;
    let title: string;
    let sub: string;
    const status = statusText(spatial.status);
    if (needsConfirm) {
      tone = "pending";
      title = "幾何候選";
      sub = "點擊確認門或窗";
    } else if (spatial.star) {
      tone = spatial.isGood ? "good" : "bad";
      title = STARS[spatial.star].name;
      sub = STAR_SHORT[spatial.star];
    } else {
      tone = "pending";
      title = defOf(t.kind as ObjectKind).zh;
      sub = "方位資料不足";
    }
    // 含使用者偏移的框（拖曳只移動貼紙卡；光框留在物件上，避免把「偵測位置」說謊成使用者位置）
    const box = { ...t.box };
    const view: StickerView = {
      id: t.id,
      tone,
      title,
      sub,
      status: needsConfirm ? "待確認" : status,
      box,
      userOffX: t.userOffset.dx * this.layerW,
      userOffY: t.userOffset.dy * this.layerH,
      showCard: plan ? plan.showCard : true,
      scale: plan ? plan.scale : 1,
      fading: t.state === "fading",
      needsConfirm,
    };
    return view;
  }

  /* ---------- 拍照支援 ---------- */

  /** 擷取可見區全解析度畫布（原始照與 AR 合成照共用同一影格，規格 10） */
  captureVisibleCanvas(maxEdge = 2048): HTMLCanvasElement | null {
    if (this.cam.state !== "running") return null;
    const video = this.cam.video;
    if (!video) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const crop = computeCoverCrop(vw, vh, this.layerW, this.layerH);
    let w = Math.round(crop.sw);
    let h = Math.round(crop.sh);
    const down = Math.min(1, maxEdge / Math.max(w, h));
    w = Math.round(w * down);
    h = Math.round(h * down);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    return canvas;
  }

  /** 目前活躍的貼紙內容（AR 合成照用；與畫面同一追蹤快照） */
  currentPhotoStickers(): PhotoSticker[] {
    const out: PhotoSticker[] = [];
    const tracks = this.tracker.tracks;
    for (const t of tracks) {
      const cx = t.box.x + t.box.w / 2;
      const spatial = interpret(
        {
          headingDeg: this.ctx.headingDeg,
          quality: this.ctx.quality,
          tiltDegraded: this.ctx.tiltDegraded,
          homeAtCenter: this.ctx.homeAtCenter,
          boxCenterXNorm: cx,
          confirmed: t.source === "model" || t.confirmed,
        },
        this.ctx.wheel,
      );
      const v = this.buildView(t, spatial, undefined);
      if (t.state !== "active") continue; // 只拍活躍追蹤（fading 不宣稱有效）
      if (spatial.status === "pending" && !v.needsConfirm) continue;
      out.push({
        box: t.box,
        tone: v.tone,
        title: v.title,
        sub: v.sub,
        status: v.status,
      });
    }
    return out;
  }

  /** 供 Bottom Sheet 顯示的追蹤資訊 */
  trackInfo(id: number): { kind: string; source: "model" | "geo"; score: number; spatial: ReturnType<typeof interpret>; heightPx: number } | null {
    const t = this.tracker.find(id);
    if (!t) return null;
    const cx = t.box.x + t.box.w / 2;
    const spatial = interpret(
      {
        headingDeg: this.ctx.headingDeg,
        quality: this.ctx.quality,
        tiltDegraded: this.ctx.tiltDegraded,
        homeAtCenter: this.ctx.homeAtCenter,
        boxCenterXNorm: cx,
        confirmed: t.source === "model" || t.confirmed,
      },
      this.ctx.wheel,
    );
    return {
      kind: t.kind,
      source: t.source,
      score: t.score,
      spatial,
      heightPx: cardHeightPx({ track: t, spatial, areaFrac: t.box.w * t.box.h }, this.layerH),
    };
  }

  private emitStatus(): void {
    const det = getDetectorState();
    this.cb.onStatus({
      camState: this.cam.state,
      camRunning: this.cam.state === "running",
      detector: det,
      model: this.registry.get().state,
      perfLevel: this.governor.levelId,
      trackCount: this.tracker.tracks.filter((t) => t.state === "active").length,
      fps: this.fpsMedian,
      inferenceMs: this.lastInferenceMs,
    });
  }

  /** fps 由 frame loop 計算；供 governor 與診斷 */
  computeFps(): void {
    if (this.frameDts.length >= 10) {
      const sorted = [...this.frameDts].sort((a, b) => a - b);
      this.fpsMedian = 1000 / sorted[Math.floor(sorted.length / 2)];
    }
  }
}

export type { StarKey, DirectionDeg };
