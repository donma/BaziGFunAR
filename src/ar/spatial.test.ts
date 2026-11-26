import { describe, it, expect } from "vitest";
import { interpret, statusText } from "./spatial";
import { bazhaiWheel } from "../domain/bazhai/bazhai";

const wheel = bazhaiWheel(6); // 乾六命：西北伏位、北六煞、東五鬼、南絕命、西生氣…

const base = {
  headingDeg: 315,
  quality: "valid" as const,
  tiltDegraded: false,
  homeAtCenter: false,
  boxCenterXNorm: 0.5,
  confirmed: true,
};

describe("空間解讀（規格 7 誠實規則）", () => {
  it("一般模式：鏡頭朝西北＋已確認物件 → 「朝向參考」，不得宣稱住宅宮位已確認", () => {
    const r = interpret(base, wheel);
    expect(r.status).toBe("heading-ref");
    expect(r.palaceBranch).toBe("西北");
    expect(r.star).toBe("fuWei");
    expect(r.bearingDeg).toBeCloseTo(315);
  });

  it("住宅中心確認＋感測 valid → 「住宅宮位已確認」", () => {
    const r = interpret({ ...base, homeAtCenter: true }, wheel);
    expect(r.status).toBe("confirmed-home");
    expect(r.star).toBe("fuWei");
  });

  it("感測 uncertain（含相對方位需校正）→ 不得標已確認", () => {
    const r = interpret({ ...base, homeAtCenter: true, quality: "uncertain" }, wheel);
    expect(r.status).toBe("heading-ref");
  });

  it("鏡頭朝天退化 → 一律 pending（淡金色待確認）", () => {
    const r = interpret({ ...base, homeAtCenter: true, tiltDegraded: true }, wheel);
    expect(r.status).toBe("pending");
    expect(r.bearingDeg).toBeNull();
  });

  it("無方位資料 → pending", () => {
    const r = interpret({ ...base, headingDeg: null, quality: "unavailable" }, wheel);
    expect(r.status).toBe("pending");
  });

  it("幾何候選未確認 → pending（不冒充已辨識）", () => {
    const r = interpret({ ...base, confirmed: false }, wheel);
    expect(r.status).toBe("pending");
  });

  it("物件在畫面右緣：方位依概估視角右偏（still 朝向參考）", () => {
    const r = interpret({ ...base, boxCenterXNorm: 0.9 }, wheel);
    // offset = 0.4 × 62 = 24.8 → 315 + 24.8 = 339.8（乾/坎交界附近？337.5 是邊界）
    expect(r.angularOffsetDeg).toBeCloseTo(24.8);
    expect(r.status).toBe("heading-ref");
  });

  it("落在扇區交界 ±2° 內 → 不得標「已確認」（交界吉凶可能跳動）", () => {
    // 337.5 為 315/0 邊界：heading 315、offset 22.5 → 恰在邊界
    const r = interpret({ ...base, homeAtCenter: true, boxCenterXNorm: 0.5 + 22.5 / 62 }, wheel);
    expect(r.nearBoundary).toBe(true);
    expect(r.status).toBe("pending");
  });

  it("畫面中央物件視角位移為 0", () => {
    const r = interpret({ ...base, boxCenterXNorm: 0.5 }, wheel);
    expect(r.angularOffsetDeg).toBeCloseTo(0);
  });
});

describe("狀態短語（決策 25A）", () => {
  it("三種狀態文案", () => {
    expect(statusText("confirmed-home")).toBe("住宅宮位已確認");
    expect(statusText("heading-ref")).toBe("朝向參考");
    expect(statusText("pending")).toBe("待確認");
  });
});
