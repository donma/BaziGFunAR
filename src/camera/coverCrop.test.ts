import { describe, it, expect } from "vitest";
import { computeCoverCrop } from "./coverCrop";

describe("拍照裁切與螢幕 object-fit: cover 一致", () => {
  it("橫向 1920×1080 的影像塞進直式 390×844：左右各裁掉一塊，高度完整保留", () => {
    const c = computeCoverCrop(1920, 1080, 390, 844);
    expect(c.scale).toBeCloseTo(844 / 1080, 6);
    expect(c.sh).toBeCloseTo(1080, 6);
    expect(c.sy).toBeCloseTo(0, 6);
    expect(c.sw).toBeCloseTo(390 / (844 / 1080), 6);
    expect(c.sx).toBeCloseTo((1920 - c.sw) / 2, 6);
    // 裁切區寬高比必須等於螢幕寬高比
    expect(c.sw / c.sh).toBeCloseTo(390 / 844, 6);
  });

  it("直向 1080×1920 影像塞進 390×844（iOS 直式相機）：左右各裁一點點", () => {
    const c = computeCoverCrop(1080, 1920, 390, 844);
    expect(c.sw / c.sh).toBeCloseTo(390 / 844, 6);
    expect(c.sy).toBeCloseTo(0, 6); // 高度剛好撐滿
    expect(c.sx).toBeGreaterThan(0);
    expect(c.sx + c.sw).toBeLessThanOrEqual(1080 + 1e-9);
  });

  it("橫式螢幕 844×390 配橫向影像：上下裁切", () => {
    const c = computeCoverCrop(1920, 1080, 844, 390);
    expect(c.sw / c.sh).toBeCloseTo(844 / 390, 6);
    expect(c.sx).toBeCloseTo(0, 6);
    expect(c.sy).toBeGreaterThan(0);
  });

  it("寬高比相同則不裁切", () => {
    const c = computeCoverCrop(1600, 900, 800, 450);
    expect(c.sx).toBeCloseTo(0, 6);
    expect(c.sy).toBeCloseTo(0, 6);
    expect(c.sw).toBeCloseTo(1600, 6);
    expect(c.sh).toBeCloseTo(900, 6);
  });
});
