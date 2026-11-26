import { describe, it, expect } from "vitest";
import { edgeSupport, quadsFromPeaks } from "./geometric";

describe("幾何候選（純函式部分）", () => {
  it("邊界支撐度：完整邊框 =1，缺邊 <1", () => {
    const W = 40;
    const H = 30;
    const flags = new Uint8Array(W * H);
    // 畫一個 (5,5)-(35,25) 的實線框
    for (let x = 5; x <= 35; x++) {
      flags[5 * W + x] = 1;
      flags[25 * W + x] = 1;
    }
    for (let y = 5; y <= 25; y++) {
      flags[y * W + 5] = 1;
      flags[y * W + 35] = 1;
    }
    const full = edgeSupport(flags, W, H, 5, 5, 35, 25, 1);
    expect(full).toBeGreaterThan(0.95);

    // 抹掉下邊 → 支撐度明顯下降
    for (let x = 5; x <= 35; x++) flags[25 * W + x] = 0;
    const partial = edgeSupport(flags, W, H, 5, 5, 35, 25, 1);
    expect(partial).toBeLessThan(0.8);
    expect(partial).toBeGreaterThan(0.4);
  });

  it("空白畫面支撐度 = 0", () => {
    const flags = new Uint8Array(100 * 100);
    expect(edgeSupport(flags, 100, 100, 10, 10, 90, 90)).toBe(0);
  });

  it("由投影峰組合矩形：長寬比與最小邊過濾", () => {
    const W = 120;
    const H = 90;
    const quads = quadsFromPeaks([20, 100], [10, 80], W, H, { minSide: 18 });
    expect(quads.length).toBe(1);
    expect(quads[0]).toEqual({ x0: 20, y0: 10, x1: 100, y1: 80 });
  });

  it("長寬比超過上限的組合被丟棄", () => {
    const W = 120;
    const H = 90;
    // 20..100 寬 80；y 10..20 高 10 → aspect 8 > 3.2
    const quads = quadsFromPeaks([20, 100], [10, 20], W, H, { minSide: 8 });
    expect(quads.length).toBe(0);
  });

  it("峰太近（小於 minSide）不組合", () => {
    const quads = quadsFromPeaks([20, 30], [10, 80], 120, 90, { minSide: 18 });
    expect(quads.length).toBe(0);
  });
});
