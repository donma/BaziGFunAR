/**
 * 拍照（規格 10／決策 17B）：按一次快門同時產出
 *   1. 原始實景照片（不含任何 AR 內容）
 *   2. AR 合成照片（同一影格＋同一份渲染快照畫出的偽 VR 八宅盤＋暗角調色＋資訊卡）
 * 兩張照片與同一筆紀錄 ID 關聯；預設本機保存，不需二次確認。
 *
 * 座標對齊：盤面以畫布寬高投影（與螢幕 cover 裁切同比例），所以合成照的盤面與拍照當下畫面一致。
 */
import { drawVR, type RenderState } from "../vr/render";

const SANS = `"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif`;

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
    await document.fonts.load(`700 ${samplePx}px "BZ Serif"`, "吉凶方位伏位生氣");
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

/** 與畫面一致的暗角調色（Safari 不支援 ctx.filter，改用疊色） */
function drawGrade(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = "rgba(10,7,3,0.14)";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, "rgba(10,7,3,0)");
  g.addColorStop(1, "rgba(10,7,3,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** 底部資訊卡（樣式沿用原版拍照合成） */
function drawInfoCard(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, info: CaptureInfo, serif: string): void {
  const W = canvas.width;
  const H = canvas.height;
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
  ctx.font = `700 ${fsHead}px ${SANS}`;
  ctx.fillText(info.headline, cardX + pad, y, cardW - pad * 2);
  y += fsHead * 1.25;

  ctx.fillStyle = info.tone === "good" ? "#2b6a33" : info.tone === "bad" ? "#a3342a" : "#6b5d3f";
  ctx.font = `700 ${fsMain}px ${serif}`;
  ctx.fillText(info.main, cardX + pad, y, cardW - pad * 2);
  y += fsMain * 1.35;

  ctx.fillStyle = "#6b5d3f";
  ctx.font = `600 ${fsMeta}px ${SANS}`;
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
 * 由同一影格產出兩張照片。frame：可見區畫布（scene.captureFrame）；
 * overlay：同一時刻的渲染快照，null 表示沒有可畫的盤面（只加資訊卡）。
 */
export async function capturePair(
  frame: HTMLCanvasElement,
  overlay: RenderState | null,
  info: CaptureInfo,
): Promise<CapturePair> {
  // 1) 原始實景照：不含任何 AR 內容
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = frame.width;
  rawCanvas.height = frame.height;
  const rawCtx = rawCanvas.getContext("2d");
  if (!rawCtx) throw new Error("無法建立畫布（可能記憶體不足）");
  rawCtx.drawImage(frame, 0, 0);

  // 2) AR 合成照：同一影格＋調色＋盤面＋資訊卡
  const serif = await ensureSerifFont(frame.width * 0.058);
  const arCanvas = document.createElement("canvas");
  arCanvas.width = frame.width;
  arCanvas.height = frame.height;
  const arCtx = arCanvas.getContext("2d");
  if (!arCtx) throw new Error("無法建立畫布（可能記憶體不足）");
  arCtx.drawImage(frame, 0, 0);
  drawGrade(arCtx, arCanvas.width, arCanvas.height);
  if (overlay) drawVR(arCtx, arCanvas.width, arCanvas.height, { ...overlay, appear: 1 });
  drawInfoCard(arCtx, arCanvas, info, serif);

  const [raw, ar] = await Promise.all([canvasToBlob(rawCanvas, 0.9), canvasToBlob(arCanvas, 0.88)]);
  return { raw, ar };
}
