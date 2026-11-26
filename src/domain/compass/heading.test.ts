import { describe, it, expect } from "vitest";
import {
  normalizeDeg,
  shortestAngleDiff,
  circularLerp,
  CircularLowPass,
  SectorHysteresis,
  cameraElevationDeg,
  cameraHeadingFromEuler,
  isCameraNearVertical,
  applyDeclination,
  directionalReading,
} from "./heading";
import { starFor } from "../bazhai/bazhai";

describe("角度工具", () => {
  it("正規化", () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(359.5)).toBe(359.5);
  });
  it("最短角差與插值", () => {
    expect(shortestAngleDiff(350, 10)).toBe(-20);
    expect(shortestAngleDiff(10, 350)).toBe(20);
    expect(circularLerp(350, 10, 0.5)).toBe(0);
    expect(circularLerp(0, 90, 0.25)).toBeCloseTo(22.5);
  });
  it("低通濾波 0/360 跨越", () => {
    const f = new CircularLowPass(0.4);
    f.push(358);
    f.push(2);
    const v = f.get()!;
    // 應落在 356–364（環繞）區間，不應被拉成 180
    const unwrapped = v > 180 ? v : v + 360; // 359.6 → 359.6
    expect(unwrapped).toBeGreaterThan(356);
    expect(unwrapped).toBeLessThan(364);
  });
});

describe("扇區遲滯", () => {
  it("遲滯帶內不切換，越過後切換", () => {
    const h = new SectorHysteresis(1.5);
    h.update(30); // 30 → 扇區 45
    expect(h.get()).toBe(45);
    // 走向邊界 22.5，仍在遲滯帶（距邊界 1.5）→ 保持 45
    const r1 = h.update(24);
    expect(r1.sector).toBe(45);
    // 越過遲滯帶（距邊界 1.5 以上且已進入另一扇區）→ 切換 0
    const r2 = h.update(20);
    expect(r2.sector).toBe(0);
    expect(r2.changed).toBe(true);
  });

  it("邊界抖動（21°–24°）不造成吉凶閃爍；真正越界後才切換且回頭也需越過遲滯帶", () => {
    const h = new SectorHysteresis(1.5);
    h.update(30);
    let changes = 0;
    for (let i = 0; i < 40; i++) {
      const r = h.update(i % 2 ? 21.2 : 23.8);
      if (r.changed) changes++;
    }
    expect(changes).toBe(0);
    expect(h.get()).toBe(45);
    // 明確進入另一扇區（距邊界 > 1.5°）才切換
    expect(h.update(19.9).sector).toBe(0);
    // 回頭：24.1°（距邊界 1.6°）以上才切回 45
    expect(h.update(23.9).sector).toBe(0);
    expect(h.update(24.1).sector).toBe(45);
  });

  it("0/360 邊界同樣有遲滯（337.5° 為 315/0 交界）", () => {
    const h = new SectorHysteresis(1.5);
    h.update(350); // 0 扇區
    expect(h.get()).toBe(0);
    expect(h.update(337).sector).toBe(0); // 已過邊界 0.5°，仍在遲滯帶
    expect(h.update(335).sector).toBe(315); // 過邊界 2.5°，切換
  });

  it("一次跨多個扇區（快速轉動／掉幀）立即切到正確扇區，不被『新角度靠近自己扇區邊界』誤導而留在舊扇區", () => {
    const h = new SectorHysteresis(1.5);
    h.update(90); // 東
    expect(h.get()).toBe(90);
    // 一幀內由 90° 跳到 23°（落在 45° 扇區、距 22.5° 邊界僅 0.5°）：必須切到 45，而不是留在 90
    expect(h.update(23).sector).toBe(45);
    // 再跳到 200°（180° 扇區）、以及繞過 0/360 到 355°
    expect(h.update(200).sector).toBe(180);
    expect(h.update(355).sector).toBe(0);
    // 由 0 跳到 200，距 22.5° 邊界很近的 202.4° 也要切換
    expect(h.update(202.4).sector).toBe(180);
  });

  it("相鄰扇區的遲滯帶仍然有效：45° 扇區要偏離中心超過 22.5°＋1.5°（即低於 21°）才切換", () => {
    const h = new SectorHysteresis(1.5);
    h.update(45);
    expect(h.update(23.9).sector).toBe(45);
    expect(h.update(21.1).sector).toBe(45); // 偏離 23.9° ≤ 24°
    expect(h.update(20.9).sector).toBe(0); // 偏離 24.1° > 24°
  });
});

describe("退化與換算", () => {
  it("鏡頭仰角：直立水平 0、平放朝下 −90、翻面朝天 +90、傾斜 30°", () => {
    expect(cameraElevationDeg(90, 0)).toBeCloseTo(0, 6);
    expect(cameraElevationDeg(0, 0)).toBeCloseTo(-90, 6);
    expect(cameraElevationDeg(180, 0)).toBeCloseTo(90, 6);
    expect(cameraElevationDeg(60, 0)).toBeCloseTo(-30, 6);
    expect(cameraElevationDeg(120, 0)).toBeCloseTo(30, 6);
  });

  it("橫式握持（beta≈0、gamma≈±90）鏡頭水平，不可誤判為朝天／地", () => {
    expect(cameraElevationDeg(0, 90)).toBeCloseTo(0, 6);
    expect(cameraElevationDeg(0, -90)).toBeCloseTo(0, 6);
    expect(isCameraNearVertical(cameraElevationDeg(0, 90))).toBe(false);
    expect(isCameraNearVertical(cameraElevationDeg(0, -90))).toBe(false);
  });

  it("近垂直門檻 65°", () => {
    expect(isCameraNearVertical(66)).toBe(true);
    expect(isCameraNearVertical(-70)).toBe(true);
    expect(isCameraNearVertical(64)).toBe(false);
    expect(isCameraNearVertical(0)).toBe(false);
    // 朝天（beta=175）與平放朝下（beta=5）皆退化
    expect(isCameraNearVertical(cameraElevationDeg(175, 0))).toBe(true);
    expect(isCameraNearVertical(cameraElevationDeg(5, 0))).toBe(true);
  });

  it("歐拉角換算相機水平朝向：直立時 heading = 360° − alpha", () => {
    expect(cameraHeadingFromEuler(0, 90, 0)).toBeCloseTo(0, 6);
    expect(cameraHeadingFromEuler(90, 90, 0)).toBeCloseTo(270, 6);
    expect(cameraHeadingFromEuler(180, 90, 0)).toBeCloseTo(180, 6);
    expect(cameraHeadingFromEuler(270, 90, 0)).toBeCloseTo(90, 6);
  });

  it("俯仰不改變水平朝向（鏡頭上仰／下俯 30° 仍朝北）", () => {
    expect(cameraHeadingFromEuler(0, 120, 0)).toBeCloseTo(0, 6);
    expect(cameraHeadingFromEuler(0, 60, 0)).toBeCloseTo(0, 6);
  });

  it("橫式握持：以姿態幾何換算，不再需要螢幕角度（alpha=0, gamma=±90 → 朝西／朝東）", () => {
    expect(cameraHeadingFromEuler(0, 0, 90)).toBeCloseTo(270, 6);
    expect(cameraHeadingFromEuler(0, 0, -90)).toBeCloseTo(90, 6);
  });

  it("滾轉時 alpha 本身不等於鏡頭朝向（簡化公式會差 30°），幾何換算才正確", () => {
    const h = cameraHeadingFromEuler(0, 90, 30)!;
    expect(h).toBeCloseTo(330, 6);
  });

  it("鏡頭正上／正下時水平投影退化，回傳 null 而非亂猜", () => {
    expect(cameraHeadingFromEuler(123, 180, 0)).toBeNull();
    expect(cameraHeadingFromEuler(45, 0, 0)).toBeNull();
  });

  it("磁偏角換算（東偏正）", () => {
    expect(applyDeclination(10, 5)).toBe(15);
    expect(applyDeclination(358, 5)).toBe(3);
    expect(applyDeclination(5, -6)).toBe(359);
  });
});

describe("方位閱讀", () => {
  it("宮位與吉凶", () => {
    const r = directionalReading(0, (d) => starFor(1, d)); // 坎命北＝伏位
    expect(r.palace).toBe("坎");
    expect(r.branch).toBe("北");
    expect(r.star).toBe("fuWei");
    expect(r.nearBoundary).toBe(false);
  });
  it("交界提示", () => {
    const r = directionalReading(23, (d) => starFor(1, d));
    expect(r.nearBoundary).toBe(true);
    expect(r.palace).toBe("艮");
  });
});
