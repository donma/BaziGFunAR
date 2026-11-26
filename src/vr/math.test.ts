import { describe, it, expect } from "vitest";
import {
  azimuthDeg,
  clipNear,
  dirVector,
  elevationDeg,
  focalPx,
  orientationBasis,
  rayDirection,
  smoothBasis,
  toCamera,
  worldPoint,
  yawBasis,
  norm360,
} from "./math";
import { cameraElevationDeg, cameraHeadingFromEuler } from "../domain/compass/heading";

describe("姿態基底與原版方位引擎一致", () => {
  it("鏡頭水平朝向＝原版 cameraHeadingFromEuler（多組 alpha/beta/gamma）", () => {
    let n = 0;
    for (let alpha = 0; alpha < 360; alpha += 30) {
      for (let beta = 20; beta <= 160; beta += 20) {
        for (let gamma = -60; gamma <= 60; gamma += 30) {
          const expected = cameraHeadingFromEuler(alpha, beta, gamma);
          if (expected === null) continue;
          const b = orientationBasis(alpha, beta, gamma, 0);
          const got = azimuthDeg(b.f);
          const diff = Math.abs(((got - expected + 540) % 360) - 180);
          expect(diff, `a=${alpha} b=${beta} g=${gamma}`).toBeLessThan(1e-6);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("鏡頭仰角＝原版 cameraElevationDeg", () => {
    for (const [beta, gamma] of [[90, 0], [60, 0], [120, 0], [45, 20], [135, -25], [10, 0]]) {
      const b = orientationBasis(40, beta, gamma, 0);
      expect(elevationDeg(b.f)).toBeCloseTo(cameraElevationDeg(beta, gamma), 6);
    }
  });

  it("直立持機：alpha=0 朝北、alpha=90 朝西（270°）", () => {
    expect(azimuthDeg(orientationBasis(0, 90, 0).f)).toBeCloseTo(0, 6);
    expect(azimuthDeg(orientationBasis(90, 90, 0).f)).toBeCloseTo(270, 6);
  });

  it("基底為單位正交", () => {
    const b = orientationBasis(77, 63, -18, 0);
    const l = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
    expect(l(b.r)).toBeCloseTo(1, 9);
    expect(l(b.u)).toBeCloseTo(1, 9);
    expect(l(b.f)).toBeCloseTo(1, 9);
    expect(b.r[0] * b.f[0] + b.r[1] * b.f[1] + b.r[2] * b.f[2]).toBeCloseTo(0, 9);
  });

  it("直立持機水平時 up 朝上", () => {
    const b = orientationBasis(0, 90, 0);
    expect(b.u[1]).toBeCloseTo(1, 9);
  });
});

describe("yaw 校正與平滑", () => {
  it("yawBasis 將水平朝向順時針增加 delta，不改變仰角", () => {
    const b = orientationBasis(0, 70, 0);
    const el = elevationDeg(b.f);
    const y = yawBasis(b, 37);
    expect(azimuthDeg(y.f)).toBeCloseTo(37, 6);
    expect(elevationDeg(y.f)).toBeCloseTo(el, 6);
  });

  it("平滑：a=1 等於目標、a=0 等於原值", () => {
    const p = orientationBasis(0, 90, 0);
    const n = orientationBasis(60, 90, 0);
    expect(azimuthDeg(smoothBasis(p, n, 1).f)).toBeCloseTo(azimuthDeg(n.f), 6);
    expect(azimuthDeg(smoothBasis(p, n, 0).f)).toBeCloseTo(azimuthDeg(p.f), 6);
  });
});

describe("投影", () => {
  const b = orientationBasis(0, 90, 0); // 朝北水平

  it("正前方點落在畫面中心（x、y 皆 0）", () => {
    const c = toCamera(b, worldPoint(0, 5, 0));
    expect(c[0]).toBeCloseTo(0, 9);
    expect(c[1]).toBeCloseTo(0, 9);
    expect(c[2]).toBeCloseTo(5, 9);
  });

  it("東側的點在畫面右邊", () => {
    expect(toCamera(b, worldPoint(90, 5, 0))[0]).toBeGreaterThan(0);
  });

  it("後方的點深度為負（會被近平面裁掉）", () => {
    expect(toCamera(b, worldPoint(180, 5, 0))[2]).toBeLessThan(0);
  });

  it("朝北水平時，地面的點落在地平線下方（y<0）", () => {
    expect(toCamera(b, worldPoint(0, 3, -1.4))[1]).toBeLessThan(0);
  });

  it("焦距：直式 4:3 影像長邊視角 66° 時，螢幕高度對應 66°", () => {
    const f = focalPx(390, 844, 66);
    const vFov = 2 * Math.atan(844 / 2 / f) / (Math.PI / 180);
    // 螢幕比 3:4 更瘦長 → 以高度撐滿，垂直視角等於長邊視角
    expect(vFov).toBeCloseTo(66, 4);
  });

  it("近平面裁切：全在前方不變、全在後方清空、跨越時產生新交點", () => {
    expect(clipNear([[0, 0, 1], [1, 0, 2], [0, 1, 3]], 0.05)).toHaveLength(3);
    expect(clipNear([[0, 0, -1], [1, 0, -2], [0, 1, -3]], 0.05)).toHaveLength(0);
    const clipped = clipNear([[0, 0, 1], [1, 0, -1], [0, 1, -1]], 0.05);
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    for (const p of clipped) expect(p[2]).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it("螢幕中心射線＝forward；點擊方位與射線方位一致", () => {
    const W = 390;
    const H = 844;
    const f = focalPx(W, H, 66);
    const ray = rayDirection(b, W / 2, H / 2, W, H, f);
    expect(azimuthDeg(ray)).toBeCloseTo(0, 6);
    // 螢幕右側射線朝東偏
    const right = rayDirection(b, W - 10, H / 2, W, H, f);
    const az = azimuthDeg(right);
    expect(az).toBeGreaterThan(0);
    expect(az).toBeLessThan(45);
  });

  it("方向向量與方位角互逆", () => {
    for (const az of [0, 45, 133, 270, 359]) {
      expect(azimuthDeg(dirVector(az, 12))).toBeCloseTo(norm360(az), 6);
      expect(elevationDeg(dirVector(az, 12))).toBeCloseTo(12, 6);
    }
  });
});
