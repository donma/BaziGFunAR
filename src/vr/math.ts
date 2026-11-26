/**
 * 偽 VR 的投影數學（純函式，可單元測試）。
 *
 * 座標：x＝東、y＝上、z＝南（所以北為 -z）。方位角自北順時針。
 * 攝影機位於原點，地面是 y = -高度 的水平面。
 *
 * 姿態：以 W3C DeviceOrientation（alpha/beta/gamma）＋螢幕旋轉角換算後置鏡頭基底
 * （right／up／forward），並以 yawBasis 將水平朝向校正到感測引擎給的方位（含人工校正與磁偏角）。
 * 與原版 heading.ts 的 cameraHeadingFromEuler 以測試互相驗證，避免兩套公式漂移。
 */
export const D2R = Math.PI / 180;

export type Vec3 = [number, number, number];
export interface Basis {
  r: Vec3;
  u: Vec3;
  f: Vec3;
}

type Mat3 = number[];

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return o;
};
const rx = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const ry = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const rz = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** 由歐拉角與螢幕旋轉角取得鏡頭基底（right/up/forward，世界座標） */
export function orientationBasis(alphaDeg: number, betaDeg: number, gammaDeg: number, screenAngleDeg = 0): Basis {
  let m = mul(mul(ry(alphaDeg * D2R), rx(betaDeg * D2R)), rz(-gammaDeg * D2R));
  m = mul(m, rx(-Math.PI / 2)); // 鏡頭看向機身背面
  m = mul(m, rz(-screenAngleDeg * D2R)); // 螢幕直／橫式
  const col = (j: number): Vec3 => [m[j], m[3 + j], m[6 + j]];
  const back = col(2);
  return { r: col(0), u: col(1), f: [-back[0], -back[1], -back[2]] };
}

const mulVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** 以世界垂直軸旋轉基底，使水平朝向增加 deltaDeg（順時針） */
export function yawBasis(b: Basis, deltaDeg: number): Basis {
  const m = ry(-deltaDeg * D2R);
  return { r: mulVec(m, b.r), u: mulVec(m, b.u), f: mulVec(m, b.f) };
}

export function azimuthDeg(f: Vec3): number {
  return norm360(Math.atan2(f[0], -f[2]) / D2R);
}

export function elevationDeg(f: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, f[1]))) / D2R;
}

/** 基底平滑：對 forward／up 做指數平滑後重新正交化 */
export function smoothBasis(prev: Basis, next: Basis, a: number): Basis {
  const f = normalize([
    prev.f[0] * (1 - a) + next.f[0] * a,
    prev.f[1] * (1 - a) + next.f[1] * a,
    prev.f[2] * (1 - a) + next.f[2] * a,
  ]);
  const u0: Vec3 = [
    prev.u[0] * (1 - a) + next.u[0] * a,
    prev.u[1] * (1 - a) + next.u[1] * a,
    prev.u[2] * (1 - a) + next.u[2] * a,
  ];
  const r = normalize(cross(f, u0));
  const u = cross(r, f);
  return { r, u, f };
}

/** 方位／仰角 → 單位方向向量 */
export function dirVector(azDeg: number, elDeg: number): Vec3 {
  const a = azDeg * D2R;
  const e = elDeg * D2R;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

/** 地面極座標點：半徑 r（公尺）、方位 azDeg，高度 y（相對攝影機，地面為 -高度） */
export function worldPoint(azDeg: number, r: number, y: number): Vec3 {
  const a = azDeg * D2R;
  return [r * Math.sin(a), y, -r * Math.cos(a)];
}

/** 世界點 → 相機空間（x 右、y 上、z 前方深度） */
export function toCamera(b: Basis, p: Vec3): Vec3 {
  return [dot(p, b.r), dot(p, b.u), dot(p, b.f)];
}

/**
 * 焦距（像素）。相機畫面以 cover 填滿螢幕：影像長邊視角為 fovLongDeg，
 * 直式／橫式只決定影像比例 3:4／4:3。視角為概估值，設定中可微調。
 */
export function focalPx(W: number, H: number, fovLongDeg: number): number {
  const portrait = H >= W;
  const vw = portrait ? 3 : 4;
  const vh = portrait ? 4 : 3;
  const s = Math.max(W / vw, H / vh);
  const fv = 2 / Math.tan((fovLongDeg * D2R) / 2);
  return fv * s;
}

/** 以近平面裁切多邊形（相機空間，Sutherland–Hodgman） */
export function clipNear(poly: Vec3[], near: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = a[2] >= near;
    const bIn = b[2] >= near;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (near - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
    }
  }
  return out;
}

/** 螢幕點 → 世界方向射線 */
export function rayDirection(b: Basis, x: number, y: number, W: number, H: number, f: number): Vec3 {
  const cx = (x - W / 2) / f;
  const cy = -(y - H / 2) / f;
  const l = Math.hypot(cx, cy, 1);
  const k: Vec3 = [cx / l, cy / l, 1 / l];
  return [
    b.r[0] * k[0] + b.u[0] * k[1] + b.f[0] * k[2],
    b.r[1] * k[0] + b.u[1] * k[1] + b.f[1] * k[2],
    b.r[2] * k[0] + b.u[2] * k[1] + b.f[2] * k[2],
  ];
}
