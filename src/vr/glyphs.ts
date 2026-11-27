/**
 * 發光字貼圖（效能關鍵）：每個字只在第一次使用時畫成含霓虹光暈的貼圖並快取，
 * 之後每幀只用 drawImage 貼到地板上，避免一幀上百次 shadowBlur 讓手機發燙。
 * 字體載入完成後需呼叫 invalidateGlyphs()，否則貼圖會烘進備用字體。
 */
export const SERIF = `"BZ Serif","Songti TC","Noto Serif CJK TC","PingFang TC","Microsoft JhengHei",serif`;
export const SANS = `"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif`;

export type Tone = "cyan" | "indigo" | "warm" | "dim";

const TONES: Record<Tone, { core: number[]; glow: number[] }> = {
  cyan: { core: [236, 252, 255], glow: [64, 204, 255] },
  indigo: { core: [206, 220, 255], glow: [92, 104, 255] },
  warm: { core: [255, 234, 222], glow: [255, 124, 92] },
  dim: { core: [160, 214, 240], glow: [40, 130, 215] },
};

/** 貼圖解析度：每「單位」幾個像素 */
const S = 3;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** 貼圖邊長（單位） */
  units: number;
}

const cache = new Map<string, Sprite>();

export function invalidateGlyphs(): void {
  cache.clear();
}

const rgba = (c: number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function glyph(ch: string, size: number, tone: Tone): Sprite {
  const key = `${ch}|${size}|${tone}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const units = size * 2;
  const px = Math.ceil(units * S);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const t = TONES[tone];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${size * S}px ${SERIF}`;
    const cx = px / 2;
    const cy = px / 2;
    // 外層寬光暈
    ctx.shadowColor = rgba(t.glow, 0.95);
    ctx.fillStyle = rgba(t.glow, 0.9);
    ctx.shadowBlur = size * S * 0.62;
    ctx.fillText(ch, cx, cy);
    ctx.fillText(ch, cx, cy);
    // 中層亮暈
    ctx.shadowBlur = size * S * 0.22;
    ctx.fillStyle = rgba([(t.glow[0] + t.core[0]) / 2, (t.glow[1] + t.core[1]) / 2, (t.glow[2] + t.core[2]) / 2], 1);
    ctx.fillText(ch, cx, cy);
    // 白熱字芯
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgba(t.core, 1);
    ctx.fillText(ch, cx, cy);
  }
  const sp: Sprite = { canvas, units };
  cache.set(key, sp);
  return sp;
}

/** 在目前座標系（單位）中央貼字 */
export function drawGlyph(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number): void {
  ctx.drawImage(sp.canvas, x - sp.units / 2, y - sp.units / 2, sp.units, sp.units);
}

/** 以螢幕像素大小貼字（水平線標記用） */
export function drawGlyphPx(
  ctx: CanvasRenderingContext2D,
  sp: Sprite,
  cx: number,
  cy: number,
  sizePx: number,
  sizeUnits: number,
): void {
  const w = sp.units * (sizePx / sizeUnits);
  ctx.drawImage(sp.canvas, cx - w / 2, cy - w / 2, w, w);
}
