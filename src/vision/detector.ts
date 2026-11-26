/**
 * 本機物件偵測器（決策 18B／22B：現成套件＋輕量本機模型）。
 *
 * - @tensorflow/tfjs + coco-ssd 以動態 import 分階段載入（規格 5.4：相機優先、模型背景載入），
 *   打包為獨立 chunk，由 Service Worker 預先快取 → 離線可用。
 * - 權重（ssdlite_mobilenet_v2）由 ModelRegistry 驗證後才載入。
 * - 輸入以「畫面可見區」（cover 裁切）縮小後推論，座標輸出為可見區正規化座標（0–1），
 *   上層再乘上畫面尺寸得到 CSS px，與螢幕座標一致，不需二次換算。
 * - 只取 COCO_TO_KIND 支援的類別；不支援的類別（如 COCO 的 person）一律丟棄，不亂標。
 */

import { COCO_TO_KIND, defOf, type ObjectKind } from "./labels";
import { MODEL_JSON_URL } from "./modelRegistry";

export interface Detection {
  kind: ObjectKind;
  /** 0–1 分數 */
  score: number;
  /** 可見區正規化座標（0–1，原點左上） */
  box: { x: number; y: number; w: number; h: number };
  source: "model" | "geo";
}

export type DetectorState = "unloaded" | "loading" | "ready" | "failed";

let modelPromise: Promise<CocoModel> | null = null;
let state: DetectorState = "unloaded";
const listeners = new Set<(s: DetectorState) => void>();

type CocoModel = {
  detect(
    input: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
    maxNumBoxes?: number,
    minScore?: number,
  ): Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
  dispose(): void;
};

function setState(s: DetectorState): void {
  state = s;
  for (const cb of listeners) cb(s);
}

export function getDetectorState(): DetectorState {
  return state;
}

export function onDetectorState(cb: (s: DetectorState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

/** 載入 tfjs 與 coco-ssd（權重由 SW 快取提供；必須先通過 ModelRegistry.ensureReady） */
export async function loadDetector(): Promise<boolean> {
  if (getDetectorState() === "ready") return true;
  if (modelPromise) {
    try {
      await modelPromise;
      return getDetectorState() === "ready";
    } catch {
      return false;
    }
  }
  setState("loading");
  modelPromise = (async () => {
    const tf = await import("@tensorflow/tfjs");
    await tf.ready(); // 註冊 WebGL 後端；不可用時自動退回 CPU
    const cocoSsd = await import("@tensorflow-models/coco-ssd");
    const model = await cocoSsd.load({
      base: "lite_mobilenet_v2",
      // 版本釘選的權重來源（與 ModelRegistry 驗證的同一 URL，命中 SW 快取）
      modelUrl: MODEL_JSON_URL,
    });
    return model as unknown as CocoModel;
  })();
  try {
    await modelPromise;
    setState("ready");
    return true;
  } catch (e) {
    modelPromise = null;
    setState("failed");
    console.warn("[BaziGFunAR] 偵測模型載入失敗：", (e as Error)?.message);
    return false;
  }
}

export function disposeDetector(): void {
  void modelPromise?.then((m) => m.dispose()).catch(() => undefined);
  modelPromise = null;
  setState("unloaded");
}

/**
 * 在可見區 canvas（cover 裁切後的畫面）上偵測。
 * 回傳正規化座標（0–1）的偵測結果，依分數過濾、依面積去重（同類重疊取高分）。
 */
export async function detectOnCanvas(
  canvas: HTMLCanvasElement,
  opts: { maxBoxes?: number; minScore?: number } = {},
): Promise<Detection[]> {
  if (state !== "ready" || !modelPromise) return [];
  const model = await modelPromise;
  const maxBoxes = opts.maxBoxes ?? 6;
  const minScore = opts.minScore ?? 0.45;
  const raw = await model.detect(canvas, maxBoxes, minScore);
  const out: Detection[] = [];
  for (const r of raw) {
    const kind = COCO_TO_KIND[r.class];
    if (!kind) continue;
    const [bx, by, bw, bh] = r.bbox;
    const x = bx / canvas.width;
    const y = by / canvas.height;
    const w = bw / canvas.width;
    const h = bh / canvas.height;
    if (w <= 0.02 || h <= 0.02) continue;
    out.push({ kind, score: r.score, box: clampBox({ x, y, w, h }), source: "model" });
  }
  return dedupe(out);
}

function clampBox(b: { x: number; y: number; w: number; h: number }) {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  const w = Math.max(0.01, Math.min(1 - x, b.w));
  const h = Math.max(0.01, Math.min(1 - y, b.h));
  return { x, y, w, h };
}

/** 同類物件高度重疊時只保留分數最高者（避免同一張沙發出現兩個標籤） */
export function dedupe(dets: Detection[]): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) {
    const clash = keep.find(
      (k) => k.kind === d.kind && iou(k.box, d.box) > 0.6,
    );
    if (!clash) keep.push(d);
  }
  return keep;
}

export function iou(
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

/** 顯示用中文名 */
export function zhOf(kind: ObjectKind): string {
  return defOf(kind).zh;
}
