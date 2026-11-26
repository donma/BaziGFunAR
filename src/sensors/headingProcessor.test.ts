import { describe, it, expect } from "vitest";
import { HeadingProcessor, resolveHeading, initialHeadingState } from "./headingProcessor";
import { staleLimitMs } from "./useHeading";
import type { OrientationSample } from "./deviceOrientation";

function sample(p: Partial<OrientationSample>): OrientationSample {
  return {
    webkitHeading: null,
    webkitAccuracy: null,
    alpha: null,
    beta: null,
    gamma: null,
    absolute: false,
    eventType: "deviceorientation",
    screenOrientation: 0,
    timestamp: 0,
    ...p,
  };
}

function converge(proc: HeadingProcessor, s: OrientationSample, offset = 0, n = 60) {
  let state = initialHeadingState();
  for (let i = 0; i < n; i++) state = proc.process(s, offset, "magnetic");
  return state;
}

describe("來源判定 resolveHeading", () => {
  it("iOS：有 webkitCompassHeading 時優先使用", () => {
    const r = resolveHeading(sample({ webkitHeading: 315, webkitAccuracy: 5, alpha: 10, beta: 90, gamma: 0 }));
    expect(r.semantic).toBe("webkit-compass");
    expect(r.raw).toBe(315);
    expect(r.accuracy).toBe(5);
  });

  it("絕對歐拉角（Chrome Android deviceorientationabsolute）→ 姿態幾何換算", () => {
    const r = resolveHeading(sample({ alpha: 90, beta: 90, gamma: 0, absolute: true }));
    expect(r.semantic).toBe("absolute-euler");
    expect(r.raw).toBeCloseTo(270, 6);
  });

  it("相對歐拉角 → 語義標為 relative-euler", () => {
    const r = resolveHeading(sample({ alpha: 0, beta: 90, gamma: 0, absolute: false }));
    expect(r.semantic).toBe("relative-euler");
  });

  it("沒有任何可用欄位 → 無來源", () => {
    expect(resolveHeading(sample({}))).toEqual({ raw: null, semantic: null, accuracy: null });
  });
});

describe("HeadingProcessor 品質與退化", () => {
  it("iOS 精度良好 → valid；精度差或無效(-1) → uncertain", () => {
    const ok = converge(new HeadingProcessor(), sample({ webkitHeading: 90, webkitAccuracy: 10, beta: 90, gamma: 0 }));
    expect(ok.quality).toBe("valid");
    const bad = converge(new HeadingProcessor(), sample({ webkitHeading: 90, webkitAccuracy: 50, beta: 90, gamma: 0 }));
    expect(bad.quality).toBe("uncertain");
    const invalid = converge(new HeadingProcessor(), sample({ webkitHeading: 90, webkitAccuracy: -1, beta: 90, gamma: 0 }));
    expect(invalid.quality).toBe("uncertain");
  });

  it("相對歐拉角永遠不是 valid（方位未綁定地球北）", () => {
    const s = converge(new HeadingProcessor(), sample({ alpha: 0, beta: 90, gamma: 0, absolute: false }));
    expect(s.semantic).toBe("relative-euler");
    expect(s.quality).toBe("uncertain");
  });

  it("橫式握持（gamma=±90, beta=0）不被誤判為朝天／地", () => {
    for (const gamma of [90, -90]) {
      const s = converge(new HeadingProcessor(), sample({ webkitHeading: 200, webkitAccuracy: 5, beta: 0, gamma }));
      expect(s.tiltDegraded, `gamma=${gamma}`).toBe(false);
      expect(s.quality).toBe("valid");
    }
  });

  it("鏡頭朝天（beta=175）與平放朝下（beta=5）→ 退化、cameraAzimuth=null、quality=uncertain", () => {
    for (const beta of [175, 5]) {
      const s = converge(new HeadingProcessor(), sample({ webkitHeading: 200, webkitAccuracy: 5, beta, gamma: 0 }));
      expect(s.tiltDegraded, `beta=${beta}`).toBe(true);
      expect(s.cameraAzimuth).toBeNull();
      expect(s.quality).toBe("uncertain");
    }
  });

  it("歐拉角來源在鏡頭正上方時 raw=null，保留最後有效濾波值而非亂跳", () => {
    const proc = new HeadingProcessor();
    converge(proc, sample({ alpha: 90, beta: 90, gamma: 0, absolute: true })); // 270
    const s = proc.process(sample({ alpha: 10, beta: 180, gamma: 0, absolute: true }), 0, "magnetic");
    expect(s.rawHeading).toBeNull();
    expect(s.tiltDegraded).toBe(true);
    expect(s.displayHeading).toBeCloseTo(270, 1);
  });
});

describe("HeadingProcessor 平滑與偏移", () => {
  it("顯示值平滑、rawHeading 保持原始（不被平滑改寫）", () => {
    const proc = new HeadingProcessor();
    proc.process(sample({ webkitHeading: 0, webkitAccuracy: 5, beta: 90, gamma: 0 }), 0, "magnetic");
    const s = proc.process(sample({ webkitHeading: 90, webkitAccuracy: 5, beta: 90, gamma: 0 }), 0, "magnetic");
    expect(s.rawHeading).toBe(90);
    expect(s.displayHeading!).toBeGreaterThan(0);
    expect(s.displayHeading!).toBeLessThan(90);
  });

  it("0/360 跨越：358 → 2 不會繞到 180", () => {
    const proc = new HeadingProcessor();
    converge(proc, sample({ webkitHeading: 358, webkitAccuracy: 5, beta: 90, gamma: 0 }), 0, 30);
    const s = proc.process(sample({ webkitHeading: 2, webkitAccuracy: 5, beta: 90, gamma: 0 }), 0, "magnetic");
    const d = s.displayHeading!;
    expect(d > 350 || d < 10).toBe(true);
  });

  it("人工偏移加在濾波之後：校正立即生效", () => {
    const proc = new HeadingProcessor();
    const s0 = converge(proc, sample({ webkitHeading: 100, webkitAccuracy: 5, beta: 90, gamma: 0 }), 0);
    expect(s0.displayHeading).toBeCloseTo(100, 1);
    const s1 = proc.process(sample({ webkitHeading: 100, webkitAccuracy: 5, beta: 90, gamma: 0 }), 25, "magnetic");
    expect(s1.displayHeading).toBeCloseTo(125, 1);
    expect(s1.rawHeading).toBe(100); // 原始值不含偏移
    const s2 = proc.process(sample({ webkitHeading: 100, webkitAccuracy: 5, beta: 90, gamma: 0 }), -110, "magnetic");
    expect(s2.displayHeading).toBeCloseTo(350, 1);
  });

  it("交界提示：距邊界 ≤2° 時 nearBoundary", () => {
    const s = converge(new HeadingProcessor(), sample({ webkitHeading: 23, webkitAccuracy: 5, beta: 90, gamma: 0 }));
    expect(s.nearBoundary).toBe(true);
    const far = converge(new HeadingProcessor(), sample({ webkitHeading: 45, webkitAccuracy: 5, beta: 90, gamma: 0 }));
    expect(far.nearBoundary).toBe(false);
  });
});

describe("感測中斷判定門檻（依來源）", () => {
  it("iOS 指南針固定頻率送出：3 秒沒資料就是真的中斷", () => {
    expect(staleLimitMs("webkit-compass")).toBe(3000);
  });

  it("歐拉角事件只在姿態改變時才送：手機靜止時不可很快誤報中斷（否則會連帶停用拍照）", () => {
    expect(staleLimitMs("absolute-euler")).toBeGreaterThanOrEqual(15000);
    expect(staleLimitMs("relative-euler")).toBeGreaterThanOrEqual(15000);
    expect(staleLimitMs(null)).toBeGreaterThanOrEqual(15000);
  });
});
