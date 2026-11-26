/**
 * 偽 VR 場景控制器：相機＋方向感測＋Canvas 渲染迴圈。
 *
 * - 姿態：自己訂閱方向事件取得 alpha/beta/gamma 建立 3D 基底；水平朝向則以感測引擎輸出
 *   （含人工校正、磁偏角、朝天凍結）校正，所以盤面與 HUD 顯示的方位永遠一致。
 * - 平滑：基底指數平滑；扇區亮度以緩動值過渡（只在轉動時變化，無持續動畫）。
 * - 點擊：螢幕點 → 射線方位 → 扇區，開啟該扇區資訊卡。
 * - 拍照：擷取同一影格＋同一份渲染快照，原始照與 AR 合成照時間對齊。
 */
import { createCameraManager, type CameraManager } from "../camera/cameraManager";
import { computeCoverCrop } from "../camera/coverCrop";
import { subscribeOrientation, type OrientationSample } from "../sensors/deviceOrientation";
import { SectorHysteresis, shortestAngleDiff, normalizeDeg } from "../domain/compass/heading";
import { PALACES, sectorCenterDeg, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import {
  azimuthDeg,
  focalPx,
  orientationBasis,
  rayDirection,
  smoothBasis,
  yawBasis,
  type Basis,
} from "./math";
import { drawVR, type RenderState } from "./render";

export interface SceneInput {
  /** 感測引擎的顯示方位（已含校正／磁偏角／朝天凍結）；null＝無 */
  heading: number | null;
  /** 方位不可信（相對方位、精度差、感測中斷）：整體降亮度 */
  dim: boolean;
  wheel: Record<DirectionDeg, StarKey> | null;
  fovLongDeg: number;
  selectedSector: DirectionDeg | null;
}

export interface VRSceneCallbacks {
  onTapSector: (sector: DirectionDeg) => void;
}

const SMOOTH = 0.42;
const NEAR_VERTICAL = 0.94;

function screenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

export class VRScene {
  readonly cam: CameraManager;
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: VRSceneCallbacks;

  private input: SceneInput = { heading: null, dim: true, wheel: null, fovLongDeg: 66, selectedSector: null };
  private sample: OrientationSample | null = null;
  private basis: Basis | null = null;
  private delta = 0;
  private deltaInit = false;
  private hyst = new SectorHysteresis(1.5);
  private glow: Record<number, number> = {};
  private appear = 0;
  private lastTs = 0;
  private raf = 0;
  private unsub: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private disposed = false;
  private down: { x: number; y: number; t: number; id: number } | null = null;
  facingSector: DirectionDeg | null = null;

  constructor(host: HTMLElement, cb: VRSceneCallbacks) {
    this.host = host;
    this.cb = cb;
    this.cam = createCameraManager();

    this.canvas = document.createElement("canvas");
    this.canvas.className = "vr-canvas";
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布");
    this.ctx = ctx;

    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", () => (this.down = null));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  /* ---------- 生命週期 ---------- */

  start(): void {
    if (this.raf || this.disposed) return;
    if (!this.unsub) this.unsub = subscribeOrientation((s) => (this.sample = s));
    this.lastTs = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.unsub?.();
    this.unsub = null;
    this.ro?.disconnect();
    this.cam.stop();
    this.canvas.remove();
  }

  /** 由 React 每次 render 更新；成本極低 */
  setInput(input: SceneInput): void {
    this.input = input;
  }

  get hasOrientation(): boolean {
    return !!this.sample && this.sample.alpha !== null && this.sample.beta !== null && this.sample.gamma !== null;
  }

  async startCamera(retry = true): Promise<boolean> {
    const video = this.cam.video;
    if (!video) return false;
    video.className = "scene-video";
    const mediaHost = this.host.querySelector(".scene-media");
    if (mediaHost && !video.parentElement) mediaHost.prepend(video);
    try {
      return await this.cam.start();
    } catch (err) {
      const name = (err as DOMException)?.name ?? "";
      if (retry && (name === "NotReadableError" || name === "AbortError")) {
        await new Promise((r) => setTimeout(r, 700));
        return this.startCamera(false);
      }
      throw err;
    }
  }

  stopCamera(): void {
    this.cam.stop();
  }

  /* ---------- 尺寸 ---------- */

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  /* ---------- 姿態 ---------- */

  private computeBasis(): Basis | null {
    const s = this.sample;
    if (!s || s.alpha === null || s.beta === null || s.gamma === null) return null;
    const raw = orientationBasis(s.alpha, s.beta, s.gamma, screenAngle());
    const vertical = Math.abs(raw.f[1]) > NEAR_VERTICAL;
    const h = this.input.heading;
    if (h !== null && !vertical) {
      const rawAz = azimuthDeg(raw.f);
      const target = shortestAngleDiff(h, rawAz);
      if (!this.deltaInit) {
        this.delta = target;
        this.deltaInit = true;
      } else {
        this.delta += shortestAngleDiff(target, this.delta) * 0.25;
      }
    }
    const corrected = yawBasis(raw, this.delta);
    this.basis = this.basis ? smoothBasis(this.basis, corrected, SMOOTH) : corrected;
    return this.basis;
  }

  /* ---------- 迴圈 ---------- */

  private frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastTs ? Math.min(100, ts - this.lastTs) : 16;
    this.lastTs = ts;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const b = this.computeBasis();
    if (!b || !this.input.wheel) return;

    const facingAz = azimuthDeg(b.f);
    const vertical = Math.abs(b.f[1]) > NEAR_VERTICAL;
    if (!vertical) this.facingSector = this.hyst.update(facingAz).sector;

    // 扇區亮度緩動（面向的扇區亮、其餘暗），只在轉動時變化
    const k = 1 - Math.exp(-dt / 140);
    for (const p of PALACES) {
      const target = this.facingSector === p.deg ? 1 : 0;
      const cur = this.glow[p.deg] ?? 0;
      this.glow[p.deg] = cur + (target - cur) * k;
    }
    // 初次出現淡入（一次性）
    this.appear = Math.min(1, this.appear + dt / 650);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawVR(ctx, this.W, this.H, this.snapshot(b, facingAz) as RenderState);
  };

  private snapshot(b: Basis, facingAz: number): RenderState {
    return {
      basis: b,
      fovLongDeg: this.input.fovLongDeg,
      wheel: this.input.wheel,
      facingAz,
      glow: { ...this.glow },
      selectedSector: this.input.selectedSector,
      dim: this.input.dim,
      appear: this.appear,
    };
  }

  /* ---------- 點擊 ---------- */

  private onDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId || !this.basis) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 600) return;
    const r = this.canvas.getBoundingClientRect();
    const f = focalPx(this.W, this.H, this.input.fovLongDeg);
    const ray = rayDirection(this.basis, e.clientX - r.left, e.clientY - r.top, this.W, this.H, f);
    const az = normalizeDeg(azimuthDeg(ray));
    const sector = sectorCenterDeg(az);
    if (sector !== null && this.input.wheel) this.cb.onTapSector(sector);
  };

  /* ---------- 拍照 ---------- */

  /** 擷取可見區畫布（與螢幕 cover 裁切一致） */
  captureFrame(maxEdge = 2048): HTMLCanvasElement | null {
    if (this.cam.state !== "running") return null;
    const video = this.cam.video;
    if (!video) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const crop = computeCoverCrop(vw, vh, this.W, this.H);
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

  /** 目前這一刻的渲染快照（AR 合成照使用）；沒有姿態資料時為 null */
  captureState(): RenderState | null {
    if (!this.basis || !this.input.wheel) return null;
    return this.snapshot(this.basis, azimuthDeg(this.basis.f));
  }
}
