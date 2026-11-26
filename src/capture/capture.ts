/**
 * 拍照（規格 10／決策 17B）：按一次快門同時產出
 *   1. 原始實景照片（不含 Sticker 與光框）
 *   2. AR 合成照片（與拍照當下同一影格對齊的 Sticker 與光框）
 * 兩張照片與同一筆紀錄 ID 關聯；預設本機保存，不需二次確認。
 *
 * 座標對齊：偵測框是可見區正規化座標，畫布同為可見區 cover 裁切，
 * 因此框位置直接乘上畫布寬高即可與畫面完全一致。
 */

import type { PhotoSticker } from "../ar/pipeline";

const TONE: Record<string, { stroke: string; glow: string; text: string }> = {
  good: { stroke: "#7eb276", glow: "rgba(126,178,118,0.45)", text: "#eaf3e6" },
  bad: { stroke: "#cb6c5c", glow: "rgba(203,108,92,0.45)", text: "#f7e9e6" },
  pending: { stroke: "#d4b26a", glow: "rgba(212,178,106,0.45)", text: "#f6efd8" },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function ensureSerifFont(samplePx: number): Promise<string> {
  try {
    await document.fonts.load(`700 ${samplePx}px "BZ Serif"`, "吉凶方位");
    return `"BZ Serif","Songti TC",serif`;
  } catch {
    return `"Songti TC","Noto Serif CJK TC",serif`;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG 輸出失敗（可能記憶體不足）"))),
      "image/jpeg",
      quality,
    );
  });
}

export interface CaptureInfo {
  /** 第一行：人物與命卦 */
  headline: string;
  /** 主行：狀態與方位（或「無方位資料」） */
  main: string;
  /** 小字：時間、基準、來源 */
  meta: string;
  warn?: string;
  tone: "good" | "bad" | "none";
}

/** 繪製 AR 內容（光框＋貼紙）到畫布上 */
function drawAr(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  stickers: PhotoSticker[],
  serif: string,
): void {
  const W = canvas.width;
  const H = canvas.height;
  const sans = `"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif`;
  for (const s of stickers) {
    const t = TONE[s.tone] ?? TONE.pending;
    const x = s.box.x * W;
    const y = s.box.y * H;
    const w = s.box.w * W;
    const h = s.box.h * H;
    // 光框
    ctx.save();
    ctx.lineWidth = Math.max(3, W * 0.004);
    ctx.strokeStyle = t.stroke;
    ctx.setLineDash(s.tone === "pending" ? [W * 0.014, W * 0.01] : []);
    ctx.shadowColor = t.glow;
    ctx.shadowBlur = W * 0.02;
    roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.09);
    ctx.stroke();
    ctx.restore();

    // 貼紙卡（框上方置中）
    const cardH = Math.max(56, H * 0.075);
    const cardW = Math.max(W * 0.36, Math.min(W * 0.56, w * 1.35));
    const cx = Math.max(cardW / 2 + 8, Math.min(W - cardW / 2 - 8, x + w / 2));
    const cy = Math.max(cardH / 2 + 8, Math.min(H - cardH / 2 - 8, y - cardH * 0.62));
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = W * 0.02;
    ctx.shadowOffsetY = W * 0.006;
    roundRect(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, cardH * 0.26);
    ctx.fillStyle = "rgba(22,17,10,0.84)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, W * 0.0025);
    ctx.strokeStyle = t.stroke;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();

    const fsTitle = cardH * 0.34;
    const fsSub = cardH * 0.2;
    const fsStatus = cardH * 0.18;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = t.text;
    ctx.font = `700 ${fsTitle}px ${serif}`;
    ctx.fillText(s.title, cx, cy - cardH / 2 + cardH * 0.12, cardW * 0.9);
    ctx.fillStyle = "rgba(240,234,220,0.92)";
    ctx.font = `600 ${fsSub}px ${sans}`;
    ctx.fillText(s.sub, cx, cy - cardH / 2 + cardH * 0.52, cardW * 0.9);
    ctx.fillStyle = t.stroke;
    ctx.font = `700 ${fsStatus}px ${sans}`;
    ctx.fillText(s.status, cx, cy - cardH / 2 + cardH * 0.74, cardW * 0.9);
  }
}

/** 底部資訊卡（樣式沿用原版拍照合成） */
function drawInfoCard(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  info: CaptureInfo,
  serif: string,
): void {
  const W = canvas.width;
  const H = canvas.height;
  const sans = `"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif`;
  const m = W * 0.04;
  const cardW = W - m * 2;
  const pad = W * 0.035;
  const fsHead = W * 0.032;
  const fsMain = W * 0.058;
  const fsMeta = W * 0.026;
  const cardH = pad * 2 + fsHead * 1.25 + fsMain * 1.35 + fsMeta * 1.4 + (info.warn ? fsMeta * 1.5 : 0);
  const cardX = m;
  const cardY = H - m - cardH;

  roundRect(ctx, cardX, cardY, cardW, cardH, W * 0.03);
  ctx.fillStyle = "rgba(250,245,232,0.93)";
  ctx.fill();
  ctx.lineWidth = Math.max(1, W * 0.0025);
  ctx.strokeStyle = "rgba(201,164,92,0.85)";
  ctx.stroke();

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let y = cardY + pad;
  ctx.fillStyle = "#5a4d33";
  ctx.font = `700 ${fsHead}px ${sans}`;
  ctx.fillText(info.headline, cardX + pad, y, cardW - pad * 2);
  y += fsHead * 1.25;

  ctx.fillStyle = info.tone === "good" ? "#2b6a33" : info.tone === "bad" ? "#a3342a" : "#6b5d3f";
  ctx.font = `700 ${fsMain}px ${serif}`;
  ctx.fillText(info.main, cardX + pad, y, cardW - pad * 2);
  y += fsMain * 1.35;

  ctx.fillStyle = "#6b5d3f";
  ctx.font = `600 ${fsMeta}px ${sans}`;
  ctx.fillText(info.meta, cardX + pad, y, cardW - pad * 2);
  if (info.warn) {
    y += fsMeta * 1.5;
    ctx.fillStyle = "#9a5a08";
    ctx.fillText(info.warn, cardX + pad, y, cardW - pad * 2);
  }
}

export interface CapturePair {
  raw: Blob;
  ar: Blob;
}

/**
 * 由同一影格產出兩張照片。frame：可見區畫布（pipeline.captureVisibleCanvas）。
 */
export async function capturePair(
  frame: HTMLCanvasElement,
  stickers: PhotoSticker[],
  info: CaptureInfo,
): Promise<CapturePair> {
  // 1) 原始實景照：不含任何 AR 內容
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = frame.width;
  rawCanvas.height = frame.height;
  const rawCtx = rawCanvas.getContext("2d");
  if (!rawCtx) throw new Error("無法建立畫布（可能記憶體不足）");
  rawCtx.drawImage(frame, 0, 0);

  // 2) AR 合成照：同一影格＋當下快照的貼紙與光框＋資訊卡
  const serif = await ensureSerifFont(frame.width * 0.058);
  const arCanvas = document.createElement("canvas");
  arCanvas.width = frame.width;
  arCanvas.height = frame.height;
  const arCtx = arCanvas.getContext("2d");
  if (!arCtx) throw new Error("無法建立畫布（可能記憶體不足）");
  arCtx.drawImage(frame, 0, 0);
  drawAr(arCtx, arCanvas, stickers, serif);
  drawInfoCard(arCtx, arCanvas, info, serif);

  const [raw, ar] = await Promise.all([
    canvasToBlob(rawCanvas, 0.9),
    canvasToBlob(arCanvas, 0.88),
  ]);
  return { raw, ar };
}
