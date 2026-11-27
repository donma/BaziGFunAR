/**
 * 偽 VR 八宅盤渲染器（Canvas 2D，自帶透視投影；不依賴 WebGL）。
 *
 * 視角是第一人稱：你站在羅盤中央，腳下與四周是發光的霓虹八宅盤。
 * 配色：青藍霓虹＋白熱字芯；吉方亮青、凶方深靛並帶一點暖色邊光。
 * 文字圈（由內而外）：卦名、八星名（含方位與吉凶）、十二地支、二十四山。
 * 發光使用加法混色；字用預烘焙的發光貼圖（glyphs.ts）以維持效能。
 *
 * 特效（fx）：2＝完整（掃描光束、擴散波紋、流光、光塵），1＝掃描與波紋，0＝靜態。
 * 特效只是裝飾：文字圈的方位位置永遠固定在真實方位上，不隨特效旋轉。
 * 誠實：地板是「假設手機離地 1.4 公尺」的虛擬平面，不是偵測到的真實地板。
 */
import { PALACES, STARS, isGoodStar, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { KUA_NUMERAL, KUA_TABLE } from "../domain/bazhai/mingGua";
import { shortestAngleDiff } from "../domain/compass/heading";
import { clipNear, dirVector, focalPx, toCamera, worldPoint, type Basis, type Vec3 } from "./math";
import { drawGlyph, drawGlyphPx, glyph, type Tone } from "./glyphs";
import { ringBranches, ringMountains, ringSolarTerms } from "./rings";
import { STAR_SHORT } from "../app/starText";

export const CAM_HEIGHT = 1.4;
export const R_IN = 0.9;
export const R_OUT = 3.55;
const NEAR = 0.05;

const CORE = [222, 236, 255];
const CYAN = [84, 152, 255];
const BLUE = [38, 98, 255];
const INDIGO = [104, 84, 242];
const WARM = [255, 122, 92];

const rgba = (c: number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

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
  /** 開場點亮進度（0–1） */
  appear: number;
  /** 動畫時間（秒） */
  time: number;
  /** 特效等級：2 完整、1 精簡、0 靜態 */
  fx: 0 | 1 | 2;
}

type P2 = [number, number];

/** 光塵：固定種子，位置完全由時間決定 */
const MOTES = Array.from({ length: 40 }, (_, i) => {
  const h = (n: number): number => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { az: h(1) * 360, r: 0.6 + h(2) * 3.2, phase: h(3), speed: 0.05 + h(4) * 0.06, size: 0.9 + h(5) * 1.6 };
});

export function drawVR(ctx: CanvasRenderingContext2D, W: number, H: number, s: RenderState): void {
  const k = Math.min(W, H) / 390;
  const f = focalPx(W, H, s.fovLongDeg);
  const cx = W / 2;
  const cy = H / 2;
  const b = s.basis;
  const gy = -CAM_HEIGHT;
  const dimMul = s.dim ? 0.55 : 1;
  const ap = clamp01(s.appear);
  const t = s.time;
  /** 開場由中心向外逐圈點亮 */
  const ignite = (r: number): number => clamp01((ap * 1.4 * R_OUT - r) / 0.9);

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

  /** 把繪圖座標系貼到地板：1 單位 = 1 公分，x 為 e1、y 向下為 -e2。回傳每單位螢幕像素與落點 */
  const floorTransform = (origin: Vec3, e1: P2, e2: P2): { scale: number; x: number; y: number } | null => {
    const u = 0.01;
    const p0 = proj(origin);
    const p1 = proj([origin[0] + e1[0] * u, origin[1], origin[2] - e1[1] * u]);
    const p2 = proj([origin[0] + e2[0] * u, origin[1], origin[2] - e2[1] * u]);
    if (!p0 || !p1 || !p2) return null;
    ctx.transform(p1[0] - p0[0], p1[1] - p0[1], -(p2[0] - p0[0]), -(p2[1] - p0[1]), p0[0], p0[1]);
    return { scale: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), x: p0[0], y: p0[1] };
  };
  const inView = (ft: { x: number; y: number }): boolean => ft.x > -120 && ft.x < W + 120 && ft.y > -120 && ft.y < H + 120;
  /** 近處透視會把地板文字放得過大：限制最大像素高度 */
  const fitScale = (scale: number, units: number, maxPx: number): number =>
    Math.min(1, (maxPx * k) / Math.max(1e-6, scale * units));
  /** 靠近底部操作列時淡出 */
  const bottomFade = (y: number): number => clamp01((H * 0.8 - y) / (H * 0.12));
  /** 掃描光束掠過後的亮度加成（0–0.6） */
  const sweepAt = (az: number): number => {
    if (s.fx < 1) return 0;
    const th = (t * 40) % 360;
    const d = (((th - az) % 360) + 360) % 360;
    return d < 50 ? (1 - d / 50) * 0.6 : 0;
  };

  /** 在地板上沿徑向擺字（背對的扇區自動翻轉 180°，從你的視角永遠是正的）；dt＝沿切線方向偏移（公尺） */
  const placeText = (
    az: number,
    r: number,
    text: string,
    size: number,
    tone: Tone,
    alpha: number,
    maxPx: number,
    dt = 0,
    useFade = true,
  ): void => {
    const ang = (az * Math.PI) / 180;
    const flip = Math.abs(shortestAngleDiff(az, s.facingAz)) > 90;
    const sg = flip ? -1 : 1;
    const e1: P2 = [Math.cos(ang) * sg, -Math.sin(ang) * sg];
    const e2: P2 = [Math.sin(ang) * sg, Math.cos(ang) * sg];
    const base = worldPoint(az, r, gy);
    const o: Vec3 = [base[0] + e1[0] * dt, gy, base[2] - e1[1] * dt];
    if (depthOf(o) < NEAR) return;
    ctx.save();
    const ft = floorTransform(o, e1, e2);
    if (ft && inView(ft)) {
      const sc = fitScale(ft.scale, size * 1.3, maxPx);
      ctx.scale(sc, sc);
      const a = alpha * (useFade ? bottomFade(ft.y) : 1) * ignite(r) * dimMul;
      if (a > 0.01) {
        ctx.globalAlpha *= clamp01(a);
        const chars = [...text];
        const step = size * 1.02;
        chars.forEach((ch, i) => drawGlyph(ctx, glyph(ch, size, tone), (i - (chars.length - 1) / 2) * step, 0));
      }
    }
    ctx.restore();
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* ---------- 1. 地面暗角柔光（讓霓虹從實景中浮起來） ---------- */
  {
    const c0 = proj(worldPoint(0, 0.001, gy));
    const far = proj(worldPoint(s.facingAz, R_OUT + 0.8, gy));
    if (c0 && far) {
      const r = Math.max(40, Math.hypot(far[0] - c0[0], far[1] - c0[1]) * 1.3);
      const g = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], r);
      g.addColorStop(0, `rgba(2,10,34,${0.46 * dimMul * ap})`);
      g.addColorStop(1, "rgba(2,10,34,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- 2. 八個吉凶玻璃扇區 ---------- */
  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const good = isGoodStar(star);
    const col = good ? CYAN : INDIGO;
    const gl = s.glow[c] ?? 0;
    const sel = s.selectedSector === c;
    const a0 = c - 22.5 + 0.7;
    const a1 = c + 22.5 - 0.7;
    const pts: Vec3[] = [];
    const N = 9;
    for (let i = 0; i <= N; i++) pts.push(worldPoint(a0 + ((a1 - a0) * i) / N, R_OUT, gy));
    for (let i = N; i >= 0; i--) pts.push(worldPoint(a0 + ((a1 - a0) * i) / N, R_IN, gy));
    const poly = projPoly(pts);
    if (!poly) continue;

    const base = (0.1 + 0.2 * gl + (sel ? 0.12 : 0)) * dimMul * ap;
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
    // 邊緣：吉＝青白；凶＝一點暖色邊光
    ctx.lineWidth = (1 + 1.2 * gl) * k;
    ctx.strokeStyle = good ? rgba(CORE, (0.3 + 0.4 * gl + (sel ? 0.35 : 0)) * dimMul * ap) : rgba(WARM, (0.5 + 0.35 * gl + (sel ? 0.3 : 0)) * dimMul * ap);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 5.5 * k;
    ctx.strokeStyle = good ? rgba(CYAN, (0.08 + 0.2 * gl) * dimMul * ap) : rgba(WARM, (0.1 + 0.22 * gl) * dimMul * ap);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 3. 幾何線、光環、刻度（加法混色＝發光） ---------- */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const ring = (r: number, widthPx: number, alpha: number, dash?: number[], color: number[] = CYAN): void => {
    ctx.beginPath();
    pathWorld(circlePts(r, gy));
    ctx.lineWidth = widthPx * k;
    ctx.strokeStyle = rgba(color, alpha * dimMul * ignite(r));
    ctx.setLineDash(dash ? dash.map((d) => d * k) : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // 八角幾何：多層八角形＋{8/3} 星形，像寶石切面的地板
  {
    const octagon = (R: number, alpha: number, star: boolean): void => {
      const V: Vec3[] = [];
      for (let i = 0; i < 8; i++) V.push(worldPoint(22.5 + 45 * i, R, gy));
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = proj(V[i]);
        const c2 = proj(V[(i + 1) % 8]);
        if (a && c2) {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(c2[0], c2[1]);
        }
        if (star) {
          const d = proj(V[(i + 3) % 8]);
          if (a && d) {
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(d[0], d[1]);
          }
        }
      }
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = rgba(CYAN, alpha * dimMul * ap * ignite(R));
      ctx.stroke();
    };
    octagon(R_OUT - 0.02, 0.3, true);
    octagon(3.1, 0.22, false);
    octagon(2.65, 0.28, true);
    octagon(1.55, 0.26, true);
    octagon(1.0, 0.22, false);
    // 每 15° 的細分割線
    ctx.beginPath();
    for (let a = 0; a < 360; a += 15) {
      if ((a + 22.5) % 45 === 0) continue;
      const p0 = proj(worldPoint(a, R_IN, gy));
      const p1 = proj(worldPoint(a, R_OUT, gy));
      if (p0 && p1) {
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
    }
    ctx.lineWidth = 0.7 * k;
    ctx.strokeStyle = rgba(CYAN, 0.14 * dimMul * ap);
    ctx.stroke();
  }
  // 外圈三層疊加
  ring(R_OUT, 9, 0.1, undefined, BLUE);
  ring(R_OUT, 3.2, 0.3);
  ring(R_OUT, 1.3, 0.85, undefined, CORE);
  ring(R_OUT + 0.14, 0.9, 0.5);
  ring(R_IN, 1.6, 0.75, undefined, CORE);
  ring(R_IN - 0.1, 0.8, 0.35);
  // 文字圈分隔線
  ring(1.55, 0.7, 0.3);
  ring(2.65, 0.8, 0.34);
  ring(3.1, 0.8, 0.34);
  ring(R_OUT + 0.85, 0.8, 0.3);
  ring(R_OUT + 0.17, 0.6, 0.25);
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
  ctx.strokeStyle = rgba(CYAN, 0.75 * dimMul * ap);
  ctx.stroke();

  // 掃描光束（雷達式）：只是裝飾，掠過的文字會短暫變亮
  if (s.fx >= 1 && ap > 0.6) {
    const th = (t * 40) % 360;
    const SPAN = 38;
    const M = 8;
    for (let i = 0; i < M; i++) {
      const a0 = th - SPAN + (SPAN * i) / M;
      const a1 = a0 + SPAN / M;
      const pts: Vec3[] = [];
      for (const [a, r] of [[a0, R_IN], [a0, R_OUT], [a1, R_OUT], [a1, R_IN]] as Array<[number, number]>) pts.push(worldPoint(a, r, gy));
      const poly = projPoly(pts);
      if (!poly) continue;
      ctx.beginPath();
      poly.forEach((q, j) => (j === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1])));
      ctx.closePath();
      ctx.fillStyle = rgba(CYAN, ((i + 1) / M) * 0.13 * dimMul);
      ctx.fill();
    }
    const e0 = proj(worldPoint(th, R_IN, gy));
    const e1 = proj(worldPoint(th, R_OUT, gy));
    if (e0 && e1) {
      ctx.beginPath();
      ctx.moveTo(e0[0], e0[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.lineWidth = 1.6 * k;
      ctx.strokeStyle = rgba(CORE, 0.5 * dimMul);
      ctx.stroke();
    }
  }

  // 擴散波紋：自中心向外
  if (s.fx >= 1 && ap > 0.6) {
    for (let j = 0; j < 2; j++) {
      const ph = (t / 3.6 + j * 0.5) % 1;
      const r = R_IN + (R_OUT + 0.25 - R_IN) * easeOut(ph);
      ctx.beginPath();
      pathWorld(circlePts(r, gy, 3));
      ctx.lineWidth = (1.2 + 2.2 * (1 - ph)) * k;
      ctx.strokeStyle = rgba(CORE, (1 - ph) * 0.42 * dimMul);
      ctx.stroke();
    }
  }
  ctx.restore();

  /* ---------- 4. 多圈文字（預烘焙發光貼圖；由內而外：卦名、五行洛書、方位吉凶、星名、星意、地支、二十四山、二十四節氣） ---------- */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // 二十四節氣（最外圈，朝遠方看時可見）
  for (const m of ringSolarTerms()) {
    const major = m.deg % 45 === 0;
    placeText(m.deg, 4.12, m.ch, 13, major ? "cyan" : "dim", (major ? 0.85 : 0.6) + sweepAt(m.deg) * 0.4, 36);
  }
  // 二十四山
  for (const m of ringMountains()) {
    const isGua = m.deg % 45 === 0;
    placeText(m.deg, 3.33, m.ch, 14, isGua ? "cyan" : "dim", (isGua ? 0.9 : 0.7) + sweepAt(m.deg) * 0.5, 40);
  }
  // 十二地支
  for (const m of ringBranches()) placeText(m.deg, 2.88, m.ch, 17, "cyan", 0.78 + sweepAt(m.deg) * 0.6, 50);
  // 八星名＋星意＋方位吉凶＋五行洛書＋卦名
  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const good = isGoodStar(star);
    const gl = s.glow[c] ?? 0;
    const sw = sweepAt(c);
    const kua = Object.values(KUA_TABLE).find((x) => x.name === p.name);
    placeText(c, 2.0, STARS[star].name, 34 + 4 * gl, good ? "cyan" : "indigo", 0.9 + 0.1 * gl + sw * 0.4, 110);
    placeText(c, 2.4, STAR_SHORT[star], 10.5, "dim", 0.8 + sw * 0.3, 34);
    placeText(c, 1.7, `${p.branch}方`, 13, "dim", 0.82, 40, -0.2);
    placeText(c, 1.7, good ? "吉" : "凶", 16, good ? "cyan" : "warm", 0.95 + sw * 0.3, 46, 0.32);
    if (kua) placeText(c, 1.45, `${kua.element}${KUA_NUMERAL[kua.kua]}`, 12, "dim", 0.78, 36);
    placeText(c, 1.18, p.name, 26, good ? "cyan" : "indigo", 0.88 + 0.12 * gl + sw * 0.4, 64);
  }
  ctx.restore();

  /* ---------- 5. 正下方：填滿圓心的藍色光暈大八卦（每個元件都用真實透視投影） ---------- */
  {
    const lw = (e: number, n: number): Vec3 => [e, gy, -n]; // 本地（東,北；公尺）→ 世界
    const circ = (ce: number, cn: number, r: number, n = 44): Vec3[] => {
      const pts: Vec3[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(lw(ce + r * Math.sin(a), cn + r * Math.cos(a)));
      }
      return pts;
    };
    const fillPoly = (pts: Vec3[], style: string): void => {
      const poly = projPoly(pts);
      if (!poly) return;
      ctx.beginPath();
      poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1])));
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };
    /** 極座標＋切線偏移：az 方位、r 半徑、t 沿順時針切線的偏移 */
    const polar = (az: number, r: number, t: number): Vec3 => {
      const a = (az * Math.PI) / 180;
      return lw(r * Math.sin(a) + t * Math.cos(a), r * Math.cos(a) - t * Math.sin(a));
    };
    const a5 = dimMul * ap;

    // 玻璃底：同心層疊出由外向內加深的藍色漸層，填滿圓心空白
    fillPoly(circ(0, 0, 0.88), `rgba(24,96,200,${0.2 * a5})`);
    fillPoly(circ(0, 0, 0.66), `rgba(10,50,140,${0.22 * a5})`);
    fillPoly(circ(0, 0, 0.46), `rgba(4,22,70,${0.4 * a5})`);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 同心光環
    ring(0.87, 9, 0.14, undefined, BLUE);
    ring(0.87, 3, 0.8, undefined, CORE);
    ring(0.52, 1.8, 0.75, undefined, CORE);
    ring(0.44, 1, 0.4);
    // 八卦環的分隔線
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const p0 = proj(polar(22.5 + 45 * i, 0.52, 0));
      const p1 = proj(polar(22.5 + 45 * i, 0.78, 0));
      if (p0 && p1) {
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
    }
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = rgba(CYAN, 0.45 * a5);
    ctx.stroke();
    // 八個卦象（後天八卦方位；最內側為初爻）
    for (const p of PALACES) {
      const lit = s.glow[p.deg] ?? 0;
      ctx.shadowColor = rgba(CYAN, 0.95);
      ctx.shadowBlur = (7 + 9 * lit) * k;
      for (let i = 0; i < 3; i++) {
        const r = 0.65 + (i - 1) * 0.09;
        const h = 0.027;
        const segs: Array<[number, number]> = p.lines[i] ? [[-0.16, 0.16]] : [[-0.16, -0.03], [0.03, 0.16]];
        for (const [t0, t1] of segs) {
          fillPoly([polar(p.deg, r - h, t0), polar(p.deg, r - h, t1), polar(p.deg, r + h, t1), polar(p.deg, r + h, t0)], rgba([176, 208, 255], (0.72 + 0.26 * lit) * a5));
        }
      }
    }
    ctx.restore();

    // 中央太極
    const R = 0.36;
    fillPoly(circ(0, 0, R), `rgba(4,16,52,${0.95 * a5})`);
    const half: Vec3[] = [];
    for (let i = 0; i <= 28; i++) {
      const th = -Math.PI / 2 + (i / 28) * Math.PI;
      half.push(lw(R * Math.cos(th), -R * Math.sin(th)));
    }
    fillPoly(half, rgba(CORE, 0.96 * a5));
    fillPoly(circ(0, R / 2, R / 2, 32), `rgba(4,16,52,${0.95 * a5})`);
    fillPoly(circ(0, -R / 2, R / 2, 32), rgba(CORE, 0.96 * a5));
    fillPoly(circ(0, R / 2, R / 9, 20), rgba(CORE, 0.96 * a5));
    fillPoly(circ(0, -R / 2, R / 9, 20), `rgba(4,16,52,${0.95 * a5})`);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 2.4 * k;
    ctx.shadowColor = rgba(CYAN, 0.95);
    ctx.shadowBlur = 12 * k;
    ctx.strokeStyle = rgba(CYAN, 0.95 * a5);
    const outline = circ(0, 0, R, 48);
    outline.push(outline[0]);
    ctx.beginPath();
    pathWorld(outline);
    ctx.stroke();
    ctx.restore();
  }

  // 圓心大八卦內的小字圈（畫在中心玻璃與卦象之上）：太極外圍的卦名、八卦環外緣的二十四山
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of PALACES) placeText(p.deg, 0.445, p.name, 11, "cyan", 0.9, 44, 0, false);
  for (const m of ringMountains()) placeText(m.deg, 0.815, m.ch, 7.5, "dim", 0.8, 30, 0, false);
  ctx.restore();

  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const gl = s.glow[c] ?? 0;
    const ang = (c * Math.PI) / 180;
    const flip = Math.abs(shortestAngleDiff(c, s.facingAz)) > 90;
    const sg = flip ? -1 : 1;
    const e1: P2 = [Math.cos(ang) * sg, -Math.sin(ang) * sg];
    const e2: P2 = [Math.sin(ang) * sg, Math.cos(ang) * sg];
    const og = worldPoint(c, R_OUT + 1.15, gy);
    if (depthOf(og) < NEAR) continue;
    ctx.save();
    const ft = floorTransform(og, e1, e2);
    if (ft && inView(ft)) {
      const sc = fitScale(ft.scale, 30, 40);
      ctx.scale(sc, sc);
      ctx.globalAlpha *= (0.7 + 0.3 * gl) * dimMul * bottomFade(ft.y) * ap;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba(CORE, 0.95);
      ctx.shadowColor = rgba(CYAN, 0.9);
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

  // 正北標記
  {
    const o = worldPoint(0, R_OUT + 1.75, gy);
    if (depthOf(o) > NEAR) {
      ctx.save();
      const ft = floorTransform(o, [1, 0], [0, 1]);
      if (ft) {
        const sc = fitScale(ft.scale, 50, 44);
        ctx.scale(sc, sc);
        ctx.globalAlpha *= dimMul * bottomFade(ft.y) * ap;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = rgba(CORE, 0.95);
        ctx.shadowColor = rgba(CYAN, 0.95);
        ctx.shadowBlur = 9 * k;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.lineTo(13, 10);
        ctx.lineTo(0, 3);
        ctx.lineTo(-13, 10);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        drawGlyph(ctx, glyph("北", 20, "cyan"), 0, 34);
      }
      ctx.restore();
    }
  }

  /* ---------- 6. 流光與光塵（完整特效） ---------- */
  if (s.fx >= 2 && ap > 0.8) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 沿圓環流動的光點
    const lanes: Array<[number, number]> = [[R_OUT, -26], [3.1, 34], [2.65, -42]];
    lanes.forEach(([r, speed], li) => {
      for (let n = 0; n < 3; n++) {
        const a = (t * speed + n * 120 + li * 40) % 360;
        const q = proj(worldPoint(a, r, gy));
        if (!q) continue;
        // 多層疊加做出柔和光暈（加法混色下比單一圓盤自然）
        for (const [rad, al] of [[9, 0.07], [5.5, 0.16], [3, 0.32]] as Array<[number, number]>) {
          ctx.fillStyle = rgba(CYAN, al * dimMul);
          ctx.beginPath();
          ctx.arc(q[0], q[1], rad * k, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(CORE, 0.95 * dimMul);
        ctx.beginPath();
        ctx.arc(q[0], q[1], 1.8 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 自地面升起的光塵
    for (const m of MOTES) {
      const life = (t * m.speed + m.phase) % 1;
      const q = proj(worldPoint(m.az, m.r, gy + life * 1.9));
      if (!q) continue;
      const al = Math.sin(Math.PI * life) * 0.85 * dimMul;
      for (const [mul, a] of [[3.6, 0.1], [2, 0.22]] as Array<[number, number]>) {
        ctx.fillStyle = rgba(CYAN, al * a * 3);
        ctx.beginPath();
        ctx.arc(q[0], q[1], m.size * mul * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(CORE, al);
      ctx.beginPath();
      ctx.arc(q[0], q[1], m.size * 0.8 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 7. 水平線、刻度與八道光柱 ---------- */
  ctx.save();
  {
    ctx.beginPath();
    const pts: Vec3[] = [];
    for (let a = 0; a <= 360; a += 3) pts.push(dirVector(a, 0).map((v) => v * 10) as Vec3);
    pathWorld(pts);
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = rgba(CYAN, 0.32 * dimMul * ap);
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
    ctx.strokeStyle = rgba(CYAN, 0.5 * dimMul * ap);
    ctx.stroke();
  }

  for (const p of PALACES) {
    const c = p.deg;
    const star = s.wheel?.[c];
    if (!star) continue;
    const good = isGoodStar(star);
    const col = good ? CYAN : INDIGO;
    const gl = s.glow[c] ?? 0;
    const bot = proj(dirVector(c, -3).map((v) => v * 10) as Vec3);
    const top = proj(dirVector(c, 15 + 9 * gl).map((v) => v * 10) as Vec3);
    if (bot && top) {
      const g = ctx.createLinearGradient(bot[0], bot[1], top[0], top[1]);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.3, rgba(good ? CORE : col, (0.55 + 0.4 * gl) * dimMul));
      g.addColorStop(1, rgba(col, 0));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "butt";
      ctx.strokeStyle = g;
      ctx.lineWidth = (9 + 9 * gl) * k;
      ctx.globalAlpha = (0.24 + 0.22 * gl) * ap;
      ctx.beginPath();
      ctx.moveTo(bot[0], bot[1]);
      ctx.lineTo(top[0], top[1]);
      ctx.stroke();
      ctx.globalAlpha = ap;
      ctx.lineWidth = 2.2 * k;
      ctx.stroke();
      if (!good) {
        // 凶方光柱底部一點暖色
        const wg = ctx.createLinearGradient(bot[0], bot[1], top[0], top[1]);
        wg.addColorStop(0, rgba(WARM, 0.5 * dimMul));
        wg.addColorStop(0.3, rgba(WARM, 0));
        ctx.strokeStyle = wg;
        ctx.lineWidth = 1.4 * k;
        ctx.stroke();
      }
      ctx.restore();
    }
    const lab = proj(dirVector(c, 11 + 5 * gl).map((v) => v * 10) as Vec3);
    if (lab && lab[0] > -80 && lab[0] < W + 80) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp01((0.75 + 0.25 * gl) * dimMul * ap);
      const name = STARS[star].name;
      const sizePx = (20 + 7 * gl) * k;
      const chars = [...name];
      chars.forEach((ch, i) =>
        drawGlyphPx(ctx, glyph(ch, 24, good ? "cyan" : "indigo"), lab[0] + (i - (chars.length - 1) / 2) * sizePx * 0.98, lab[1], sizePx * 1.25, 24),
      );
      const bY = lab[1] + sizePx * 0.65 + 10 * k;
      drawGlyphPx(ctx, glyph(p.branch.slice(0, 1), 16, "dim"), lab[0] - 7 * k, bY, 12 * k * 1.2, 16);
      if (p.branch.length > 1) drawGlyphPx(ctx, glyph(p.branch.slice(1, 2), 16, "dim"), lab[0] + 7 * k, bY, 12 * k * 1.2, 16);
      ctx.restore();
    }
  }
  ctx.restore();

  ctx.restore();
}

