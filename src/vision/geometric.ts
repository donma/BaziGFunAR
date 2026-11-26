/**
 * 門／窗幾何候選（規格 6：模型不支援門／窗時，採「傳統幾何法加人機確認」）。
 *
 * 誠實邊界：本模組**不是**門窗辨識器。它只從畫面梯度找出「大塊矩形邊緣候選」，
 * 全部以淡金色「待確認」標記呈現，必須由使用者點擊確認類別（門／窗／取消）後，
 * 才會轉為正式物件；使用者未確認前不給任何吉凶宣稱（規格 7）。
 *
 * 演算法（低成本、可每數秒跑一次）：
 * 1) 縮小畫面 → 灰階 → Sobel 梯度 → 二值化（均值＋k·σ）。
 * 2) 水平／垂直投影累積 → 找顯著線段（峰值）。
 * 3) 兩兩組合成矩形候選，以「邊界支撐度」評分、依長寬比與面積過濾、NMS 去重。
 *
 * 幾何評分（scoreQuad）為純函式，可單元測試；像素分析在 computeEdgeFlags。
 */

import type { Detection } from "./detector";

export interface QuadCandidate {
  /** 可見區正規化座標 */
  box: { x: number; y: number; w: number; h: number };
  /** 邊界支撐度 0–1 */
  score: number;
  source: "geo";
}

/* ---------- 純幾何評分（可測試） ---------- */

/** 檢查矩形四邊上的邊緣旗標覆蓋率（eps：容差），回傳 0–1 */
export function edgeSupport(
  flags: Uint8Array,
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  eps = 1,
): number {
  x0 = Math.max(0, Math.round(x0));
  y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(W - 1, Math.round(x1));
  y1 = Math.min(H - 1, Math.round(y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0;
  let hit = 0;
  let total = 0;
  for (let x = x0; x <= x1; x++) {
    total += 2;
    // 上邊：掃 y0..y0+eps
    for (let dy = 0; dy <= eps; dy++) {
      if (flags[y0 + dy < H ? (y0 + dy) * W + x : (H - 1) * W + x]) { hit++; break; }
    }
    // 下邊
    for (let dy = 0; dy <= eps; dy++) {
      if (flags[y1 - dy >= 0 ? (y1 - dy) * W + x : 0 * W + x]) { hit++; break; }
    }
  }
  for (let y = y0; y <= y1; y++) {
    total += 2;
    for (let dx = 0; dx <= eps; dx++) {
      if (flags[y * W + (x0 + dx < W ? x0 + dx : W - 1)]) { hit++; break; }
    }
    for (let dx = 0; dx <= eps; dx++) {
      if (flags[y * W + (x1 - dx >= 0 ? x1 - dx : 0)]) { hit++; break; }
    }
  }
  return total > 0 ? hit / total : 0;
}

/** 由四條投影峰組合出候選矩形（純幾何，可測試） */
export function quadsFromPeaks(
  xPeaks: number[],
  yPeaks: number[],
  W: number,
  H: number,
  opts: { minSide?: number; maxAspect?: number } = {},
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const minSide = opts.minSide ?? Math.min(W, H) * 0.18;
  const maxAspect = opts.maxAspect ?? 3.2;
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let i = 0; i < xPeaks.length; i++) {
    for (let j = i + 1; j < xPeaks.length; j++) {
      const x0 = Math.min(xPeaks[i], xPeaks[j]);
      const x1 = Math.max(xPeaks[i], xPeaks[j]);
      if (x1 - x0 < minSide || x1 - x0 > W * 0.96) continue;
      for (let a = 0; a < yPeaks.length; a++) {
        for (let b = a + 1; b < yPeaks.length; b++) {
          const y0 = Math.min(yPeaks[a], yPeaks[b]);
          const y1 = Math.max(yPeaks[a], yPeaks[b]);
          if (y1 - y0 < minSide || y1 - y0 > H * 0.96) continue;
          const aspect = (x1 - x0) / (y1 - y0);
          if (aspect > maxAspect || aspect < 1 / maxAspect) continue;
          out.push({ x0, y0, x1, y1 });
        }
      }
    }
  }
  return out;
}

/* ---------- 像素分析 ---------- */

function edgeFlags(data: Uint8ClampedArray, W: number, H: number): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) | 0;
  }
  const mag = new Float32Array(W * H);
  let sum = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx =
        gray[i - W - 1] + 2 * gray[i - 1] + gray[i + W - 1] -
        (gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1]);
      const gy =
        gray[i - W - 1] + 2 * gray[i - W] + gray[i - W + 1] -
        (gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1]);
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      sum += m;
    }
  }
  const mean = sum / (W * H);
  let sq = 0;
  for (let i = 0; i < mag.length; i++) sq += (mag[i] - mean) * (mag[i] - mean);
  const std = Math.sqrt(sq / (W * H));
  const th = mean + Math.max(40, std * 1.2);
  const flags = new Uint8Array(W * H);
  for (let i = 0; i < mag.length; i++) flags[i] = mag[i] > th ? 1 : 0;
  return flags;
}

/** 找投影峰值：累積超過峰值門檻的連續帶中心 */
function peaksFromProjection(proj: Float32Array, threshold: number, W: number): number[] {
  const peaks: number[] = [];
  let start = -1;
  for (let i = 0; i < proj.length; i++) {
    if (proj[i] >= threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      // 帶中心（加權）
      let s = 0;
      let wsum = 0;
      for (let k = start; k < i; k++) {
        s += proj[k] * k;
        wsum += proj[k];
      }
      peaks.push(Math.round(s / Math.max(1e-6, wsum)));
      start = -1;
    }
  }
  if (start >= 0) {
    let s = 0;
    let wsum = 0;
    for (let k = start; k < proj.length; k++) {
      s += proj[k] * k;
      wsum += proj[k];
    }
    peaks.push(Math.round(s / Math.max(1e-6, wsum)));
  }
  return peaks;
}

/* ---------- 主入口 ---------- */

/**
 * 分析可見區 canvas，回傳矩形候選（正規化座標）。
 * maxCandidates 限制輸出數量（預設 2；過多會干擾畫面，寧缺勿濫）。
 */
export function detectQuadCandidates(canvas: HTMLCanvasElement, maxCandidates = 2): QuadCandidate[] {
  const W = canvas.width;
  const H = canvas.height;
  if (W < 48 || H < 48) return [];
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const { data } = ctx.getImageData(0, 0, W, H);
  const flags = edgeFlags(data, W, H);

  // 投影
  const colProj = new Float32Array(W);
  const rowProj = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (flags[row + x]) {
        colProj[x] += 1;
        rowProj[y] += 1;
      }
    }
  }
  const colTh = H * 0.16;
  const rowTh = W * 0.16;
  const xPeaks = peaksFromProjection(colProj, colTh, W);
  const yPeaks = peaksFromProjection(rowProj, rowTh, H);
  if (xPeaks.length < 2 || yPeaks.length < 2) return [];

  const quads = quadsFromPeaks(xPeaks, yPeaks, W, H, { minSide: Math.min(W, H) * 0.2 });
  const scored: QuadCandidate[] = quads
    .map((q) => {
      const support = edgeSupport(flags, W, H, q.x0, q.y0, q.x1, q.y1, 1);
      // 面積比例限制：候選應佔畫面 3%–55%（太大是整個畫面邊框，太大無意義）
      const areaFrac = ((q.x1 - q.x0) * (q.y1 - q.y0)) / (W * H);
      const areaOk = areaFrac > 0.03 && areaFrac < 0.55 ? 1 : 0.35;
      return {
        box: {
          x: q.x0 / W,
          y: q.y0 / H,
          w: (q.x1 - q.x0) / W,
          h: (q.y1 - q.y0) / H,
        },
        score: support * areaOk,
        source: "geo" as const,
      };
    })
    .filter((c) => c.score >= 0.42)
    .sort((a, b) => b.score - a.score);

  // NMS 去重（IoU > 0.5 視為同一候選）
  const out: QuadCandidate[] = [];
  for (const c of scored) {
    const dup = out.find((o) => rectIou(o.box, c.box) > 0.5);
    if (!dup) out.push(c);
    if (out.length >= maxCandidates) break;
  }
  return out;
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

/** 幾何候選 → 待確認偵測（needsConfirm 類別尚未決定，由 UI 提供門／窗選擇） */
export function candidatesToDetections(cands: QuadCandidate[]): Detection[] {
  return cands.map((c) => ({
    kind: "door" as const, // 預設名義類別；UI 確認前一律顯示「待確認」，不顯示中文類別
    score: c.score,
    box: c.box,
    source: "geo" as const,
  }));
}
