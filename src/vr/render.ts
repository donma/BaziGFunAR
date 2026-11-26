/**
 * 偽 VR 八宅盤渲染器（Canvas 2D，自帶透視投影；不依賴 WebGL，省電且文字清晰）。
 *
 * 視覺：你站在羅盤中央，腳下是發光的八卦盤——8 個吉凶扇區（柔綠／柔紅）、星名與卦象
 * 以透視躺在地板上，外圈金色光環與刻度；水平線有 8 道光柱與方位標記。
 * 發光使用加法混色（lighter），不使用持續動畫：扇區亮度由 scene 以緩動值傳入，
 * 只在轉動時順滑過渡（決策：轉動順滑＋微光）。
 *
 * 誠實：地板是「假設手機離地 1.4 公尺」的虛擬平面，不是偵測到的真實地板。
 */
import { PALACES, STARS, isGoodStar, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { shortestAngleDiff } from "../domain/compass/heading";
import {
  clipNear,
  dirVector,
  focalPx,
  toCamera,
  worldPoint,
  type Basis,
  type Vec3,
} from "./math";

export const CAM_HEIGHT = 1.4;
export const R_IN = 0.9;
export const R_OUT = 3.4;
const NEAR = 0.05;

const GOOD = [126, 178, 118];
const BAD = [203, 108, 92];
const GOLD = [227, 201, 130];
const CREAM = [246, 241, 231];

const rgba = (c: number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const SERIF = `"BZ Serif","Songti TC","Noto Serif CJK TC","PingFang TC","Microsoft JhengHei",serif`;
const SANS = `"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif`;

export interface RenderState {
  basis: Basis;
  fovLongDeg: number;
  wheel: Record<DirectionDeg, StarKey> | null;
  /** 鏡頭水平朝向（決定地板文字的翻轉方向） */
  facingAz: number;
  /** 各扇區亮度（0–1，由 scene 緩動） */
  glow: Record<number, number>;
  selectedSector: DirectionDeg | null;
  /** 方位不可信：整體降低亮度 */
  dim: boolean;
  /** 初次出現淡入（0–1） */
  appear: number;
}

type P2 = [number, number];

export function drawVR(ctx: CanvasRenderingContext2D, W: number, H: number, s: RenderState): void {
  const k = Math.min(W, H) / 390;
  const f = focalPx(W, H, s.fovLongDeg);
  const cx = W / 2;
  const cy = H / 2;
  const b = s.basis;
  const gy = -CAM_HEIGHT;
  const dimMul = s.dim ? 0.55 : 1;

  const proj = (p: Vec3): P2 | null => {
    const c = toCamera(b, p);
    if (c[2] < NEAR) return null;
    return [cx + (f * c[0]) / c[2], cy - (f * c[1]) / c[2]];
  };
  const projPoly = (pts: Vec3[]): P2[] | null => {
    const clipped = clipNear(pts.map((p) => toCamera(b, p)), NEAR);
    if (clipped.length < 3) return null;
    return clipped.map((c) => [cx + (f * c[0]) / c[2], cy - (f * c[1]) / c[2]] as P2);
  };
  const pathWorld = (pts: Vec3[]): void => {
    let pen = false;
    for (const p of pts) {
      const q = proj(p);
      if (!q) {
        pen = false;
        continue;
      }
      if (!pen) {
        ctx.moveTo(q[0], q[1]);
        pen = true;
      } else ctx.lineTo(q[0], q[1]);
    }
  };
  const circlePts = (r: number, y: number, step = 2.5): Vec3[] => {
    const pts: Vec3[] = [];
    for (let a = 0; a <= 360; a += step) pts.push(worldPoint(a, r, y));
    return pts;
  };
  const depthOf = (p: Vec3): number => toCamera(b, p)[2];

  /** 把繪圖座標系貼到地板：1 單位 = 1 公分，x 為 e1、y 向下為 -e2。e1/e2 為（東,北）向量。回傳每單位的螢幕像素與落點 y */
  const floorTransform = (origin: Vec3, e1: P2, e2: P2): { scale: number; y: number } | null => {
    const u = 0.01;
    const p0 = proj(origin);
    const p1 = proj([origin[0] + e1[0] * u, origin[1], origin[2] - e1[1] * u]);
    const p2 = proj([origin[0] + e2[0] * u, origin[1], origin[2] - e2[1] * u]);
    if (!p0 || !p1 || !p2) return null;
    ctx.transform(p1[0] - p0[0], p1[1] - p0[1], -(p2[0] - p0[0]), -(p2[1] - p0[1]), p0[0], p0[1]);
    return { scale: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), y: p0[1] };
  };
  /** 近處透視會把地板文字放得過大：限制成最大像素高度，並在靠近底部操作列時淡出 */
  const fitScale = (scale: number, units: number, maxPx: number): number =>
    Math.min(1, (maxPx * k) / Math.max(1e-6, scale * units));
  const bottomFade = (y: number): number => Math.max(0, Math.min(1, (H * 0.8 - y) / (H * 0.12)));

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, s.appear));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* ---------- 1. 地面柔光（讓盤面從實景中浮起來） ---------- */
  {
    const c0 = proj(worldPoint(0, 0.001, gy));
    const far = proj(worldPoint(s.facingAz, R_OUT + 0.6, gy));
    if (c0 && far) {
      const r = Math.max(40, Math.hypot(far[0] - c0[0], far[1] - c0[1]) * 1.25);
      const g = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], r);
      g.addColorStop(0, `rgba(8,6,3,${0.3 * dimMul})`);
      g.addColorStop(1, "rgba(8,6,3,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- 2. 八個吉凶扇區 ---------- */
  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const col = isGoodStar(star) ? GOOD : BAD;
    const gl = s.glow[c] ?? 0;
    const sel = s.selectedSector === c;
    const a0 = c - 22.5 + 0.8;
    const a1 = c + 22.5 - 0.8;
    const pts: Vec3[] = [];
    const N = 9;
    for (let i = 0; i <= N; i++) pts.push(worldPoint(a0 + ((a1 - a0) * i) / N, R_OUT, gy));
    for (let i = N; i >= 0; i--) pts.push(worldPoint(a0 + ((a1 - a0) * i) / N, R_IN, gy));
    const poly = projPoly(pts);
    if (!poly) continue;

    const base = (0.1 + 0.2 * gl + (sel ? 0.12 : 0)) * dimMul;
    const pin = proj(worldPoint(c, R_IN, gy));
    const pout = proj(worldPoint(c, R_OUT, gy));
    let fill: string | CanvasGradient = rgba(col, base);
    if (pin && pout && Math.hypot(pout[0] - pin[0], pout[1] - pin[1]) > 2) {
      const g = ctx.createLinearGradient(pin[0], pin[1], pout[0], pout[1]);
      g.addColorStop(0, rgba(col, base * 0.3));
      g.addColorStop(0.55, rgba(col, base * 0.85));
      g.addColorStop(1, rgba(col, base * 1.6));
      fill = g;
    }
    ctx.beginPath();
    poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1])));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = (1 + 1.2 * gl) * k;
    ctx.strokeStyle = rgba(sel ? GOLD : CREAM, (0.28 + 0.4 * gl + (sel ? 0.4 : 0)) * dimMul);
    ctx.stroke();

    // 面向的扇區：內緣發光
    if (gl > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 5 * k;
      ctx.strokeStyle = rgba(col, 0.16 * gl * dimMul);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- 3. 光環、刻度、裝飾圈（加法混色＝會發光） ---------- */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const ring = (r: number, widthPx: number, alpha: number, dash?: number[]): void => {
    ctx.beginPath();
    pathWorld(circlePts(r, gy));
    ctx.lineWidth = widthPx * k;
    ctx.strokeStyle = rgba(GOLD, alpha * dimMul);
    ctx.setLineDash(dash ? dash.map((d) => d * k) : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // 外圈三層疊加：寬柔光＋中層＋細亮線
  ring(R_OUT, 9, 0.08);
  ring(R_OUT, 3.2, 0.24);
  ring(R_OUT, 1.3, 0.78);
  ring(R_OUT + 0.14, 0.9, 0.5);
  // 內圈與裝飾圈
  ring(R_IN, 1.6, 0.7);
  ring(R_IN - 0.1, 0.8, 0.35);
  ring(1.55, 0.8, 0.3, [3, 6]);
  ring(2.35, 0.7, 0.2, [2, 9]);

  // 刻度：每 5° 一格，15° 較長，45° 最長
  ctx.beginPath();
  for (let a = 0; a < 360; a += 5) {
    const len = a % 45 === 0 ? 0.3 : a % 15 === 0 ? 0.18 : 0.09;
    const p0 = proj(worldPoint(a, R_OUT + 0.17, gy));
    const p1 = proj(worldPoint(a, R_OUT + 0.17 + len, gy));
    if (p0 && p1) {
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
    }
  }
  ctx.lineWidth = 1.1 * k;
  ctx.strokeStyle = rgba(GOLD, 0.7 * dimMul);
  ctx.stroke();
  ctx.restore();

  /* ---------- 4. 中央太極 ---------- */
  ctx.save();
  {
    const ft = floorTransform(worldPoint(0, 0.0001, gy), [1, 0], [0, 1]);
    if (ft) {
      const sc = fitScale(ft.scale, 70, 46);
      ctx.scale(sc, sc);
      ctx.globalAlpha *= 0.82 * dimMul * Math.max(0.25, bottomFade(ft.y) + 0.25);
      const R = 34;
      ctx.fillStyle = "rgba(24,18,10,0.92)";
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(CREAM, 0.92);
      ctx.beginPath();
      ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(24,18,10,0.92)";
      ctx.beginPath();
      ctx.arc(0, -R / 2, R / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(CREAM, 0.92);
      ctx.beginPath();
      ctx.arc(0, R / 2, R / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(CREAM, 0.92);
      ctx.beginPath();
      ctx.arc(0, -R / 2, R / 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(24,18,10,0.92)";
      ctx.beginPath();
      ctx.arc(0, R / 2, R / 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(GOLD, 0.95);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  /* ---------- 5. 地板上的星名、方位與卦象 ---------- */
  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const good = isGoodStar(star);
    const col = good ? GOOD : BAD;
    const gl = s.glow[c] ?? 0;
    const ang = (c * Math.PI) / 180;
    // 地板文字朝向：背對的扇區翻轉 180°，確保從你的視角總是正的
    const flip = Math.abs(shortestAngleDiff(c, s.facingAz)) > 90;
    const sgn = flip ? -1 : 1;
    const e1: P2 = [Math.cos(ang) * sgn, -Math.sin(ang) * sgn];
    const e2: P2 = [Math.sin(ang) * sgn, Math.cos(ang) * sgn];

    // 星名＋方位
    const o = worldPoint(c, 2.5, gy);
    if (depthOf(o) > NEAR) {
      ctx.save();
      const ft = floorTransform(o, e1, e2);
      if (ft) {
        const sc = fitScale(ft.scale, 60, 120);
        ctx.scale(sc, sc);
        const fade = bottomFade(ft.y);
        ctx.globalAlpha *= (0.8 + 0.2 * gl) * fade * dimMul;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${30 + 5 * gl}px ${SERIF}`;
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = "rgba(10,7,3,0.5)";
        ctx.strokeText(STARS[star].name, 0, -3);
        ctx.shadowColor = rgba(col, 0.95);
        ctx.shadowBlur = (9 + 12 * gl) * k;
        ctx.fillStyle = good ? "#c4ecbb" : "#f7bcb0";
        ctx.fillText(STARS[star].name, 0, -3);
        ctx.shadowBlur = 0;
        ctx.font = `600 13px ${SANS}`;
        ctx.fillStyle = rgba(CREAM, 0.86);
        ctx.fillText(`${p.branch}方`, 0, 29);
      }
      ctx.restore();
    }

    // 外圈卦象（三爻，最內側為初爻）
    const og = worldPoint(c, R_OUT + 0.62, gy);
    if (depthOf(og) > NEAR) {
      ctx.save();
      const ft = floorTransform(og, e1, e2);
      if (ft) {
        const sc = fitScale(ft.scale, 30, 40);
        ctx.scale(sc, sc);
        ctx.globalAlpha *= (0.7 + 0.3 * gl) * dimMul * bottomFade(ft.y);
        ctx.fillStyle = rgba(GOLD, 0.95);
        ctx.shadowColor = rgba(GOLD, 0.8);
        ctx.shadowBlur = 6 * k;
        for (let i = 0; i < 3; i++) {
          const y = (1 - i) * 11;
          if (p.lines[i]) ctx.fillRect(-22, y - 2.6, 44, 5.2);
          else {
            ctx.fillRect(-22, y - 2.6, 18, 5.2);
            ctx.fillRect(4, y - 2.6, 18, 5.2);
          }
        }
      }
      ctx.restore();
    }
  }

  // 正北標記
  {
    const o = worldPoint(0, R_OUT + 1.25, gy);
    if (depthOf(o) > NEAR) {
      ctx.save();
      const ft = floorTransform(o, [1, 0], [0, 1]);
      if (ft) {
        const sc = fitScale(ft.scale, 50, 44);
        ctx.scale(sc, sc);
        ctx.globalAlpha *= dimMul * bottomFade(ft.y);
        ctx.fillStyle = rgba([232, 120, 96], 0.95);
        ctx.shadowColor = "rgba(232,120,96,0.9)";
        ctx.shadowBlur = 8 * k;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.lineTo(13, 10);
        ctx.lineTo(0, 3);
        ctx.lineTo(-13, 10);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = `700 20px ${SERIF}`;
        ctx.textAlign = "center";
        ctx.fillStyle = rgba(CREAM, 0.95);
        ctx.fillText("北", 0, 34);
      }
      ctx.restore();
    }
  }

  /* ---------- 6. 水平線、刻度與八道光柱 ---------- */
  ctx.save();
  {
    ctx.beginPath();
    const pts: Vec3[] = [];
    for (let a = 0; a <= 360; a += 3) pts.push(dirVector(a, 0).map((v) => v * 10) as Vec3);
    pathWorld(pts);
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = rgba(GOLD, 0.28 * dimMul);
    ctx.stroke();
    ctx.beginPath();
    for (let a = 0; a < 360; a += 5) {
      const len = a % 45 === 0 ? 2.6 : a % 15 === 0 ? 1.6 : 0.9;
      const p0 = proj(dirVector(a, 0).map((v) => v * 10) as Vec3);
      const p1 = proj(dirVector(a, len).map((v) => v * 10) as Vec3);
      if (p0 && p1) {
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
    }
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = rgba(GOLD, 0.45 * dimMul);
    ctx.stroke();
  }

  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const col = isGoodStar(star) ? GOOD : BAD;
    const gl = s.glow[c] ?? 0;
    const bot = proj(dirVector(c, -3).map((v) => v * 10) as Vec3);
    const top = proj(dirVector(c, 15 + 9 * gl).map((v) => v * 10) as Vec3);
    if (bot && top) {
      const g = ctx.createLinearGradient(bot[0], bot[1], top[0], top[1]);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.3, rgba(col, (0.5 + 0.4 * gl) * dimMul));
      g.addColorStop(1, rgba(col, 0));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "butt";
      ctx.strokeStyle = g;
      ctx.lineWidth = (9 + 9 * gl) * k;
      ctx.globalAlpha *= 0.22 + 0.2 * gl;
      ctx.beginPath();
      ctx.moveTo(bot[0], bot[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, Math.min(1, s.appear));
      ctx.lineWidth = 2.2 * k;
      ctx.stroke();
      ctx.restore();
    }
    const lab = proj(dirVector(c, 11 + 5 * gl).map((v) => v * 10) as Vec3);
    if (lab && lab[0] > -80 && lab[0] < W + 80) {
      ctx.save();
      ctx.globalAlpha *= (0.72 + 0.28 * gl) * dimMul;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 7 * k;
      ctx.font = `700 ${(19 + 7 * gl) * k}px ${SERIF}`;
      ctx.fillStyle = isGoodStar(star) ? "#c4ecbb" : "#f7bcb0";
      ctx.fillText(STARS[star].name, lab[0], lab[1]);
      ctx.font = `600 ${11 * k}px ${SANS}`;
      ctx.fillStyle = rgba(CREAM, 0.9);
      ctx.fillText(`${p.branch}方`, lab[0], lab[1] + 19 * k);
      ctx.restore();
    }
  }
  ctx.restore();

  ctx.restore();
}
