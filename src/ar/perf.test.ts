import { describe, it, expect } from "vitest";
import { PerfGovernor, PERF_LEVELS } from "./perf";

describe("自動效能調整（規格 12）", () => {
  it("推論過慢 → 立即降一級", () => {
    let now = 0;
    const g = new PerfGovernor({ now: () => now });
    expect(g.levelId).toBe(0);
    const changed = g.record({ inferenceMs: 400, fpsMedian: 30 });
    expect(changed).toBe(true);
    expect(g.levelId).toBe(1);
  });

  it("幀率過低 → 降級；連續觸發可一路降到最低級", () => {
    let now = 0;
    const g = new PerfGovernor({ now: () => now });
    g.record({ inferenceMs: 100, fpsMedian: 12 });
    expect(g.levelId).toBe(1);
    g.record({ inferenceMs: 100, fpsMedian: 12 });
    expect(g.levelId).toBe(2);
    g.record({ inferenceMs: 100, fpsMedian: 12 });
    expect(g.levelId).toBe(3);
    // 已到底，不再降
    expect(g.record({ inferenceMs: 100, fpsMedian: 12 })).toBe(false);
    expect(g.levelId).toBe(3);
  });

  it("持續健康達 recoverMs → 升回一級", () => {
    let now = 0;
    const g = new PerfGovernor({ now: () => now });
    g.record({ inferenceMs: 400, fpsMedian: 30 }); // 降一級
    expect(g.levelId).toBe(1);
    // 健康 44 秒：尚未回升
    now = 44000;
    expect(g.record({ inferenceMs: 100, fpsMedian: 30 })).toBe(false);
    // 第 45 秒（自第一次健康記錄起算）：回升
    now = 44000 + 46000;
    expect(g.record({ inferenceMs: 100, fpsMedian: 30 })).toBe(true);
    expect(g.levelId).toBe(0);
  });

  it("中途又過載：穩定計時重置", () => {
    let now = 0;
    const g = new PerfGovernor({ now: () => now });
    g.record({ inferenceMs: 400, fpsMedian: 30 });
    now = 30000;
    g.record({ inferenceMs: 100, fpsMedian: 30 }); // 計時開始
    now = 44000;
    g.record({ inferenceMs: 100, fpsMedian: 10 }); // 又過載 → 重置＋再降級
    expect(g.levelId).toBe(2);
    now = 44000 + 30000;
    g.record({ inferenceMs: 100, fpsMedian: 30 }); // 穩定 30 秒，未達 45 秒
    expect(g.levelId).toBe(2);
    now = 74000 + 46000;
    g.record({ inferenceMs: 100, fpsMedian: 30 });
    expect(g.levelId).toBe(1);
  });

  it("等級設定符合規格：低負載高頻率、高負載低頻率＋低解析度＋少追蹤", () => {
    expect(PERF_LEVELS[0].detectIntervalMs).toBeLessThan(PERF_LEVELS[3].detectIntervalMs);
    expect(PERF_LEVELS[0].inputWidth).toBeGreaterThan(PERF_LEVELS[3].inputWidth);
    expect(PERF_LEVELS[0].maxTracks).toBeGreaterThan(PERF_LEVELS[3].maxTracks);
  });

  it("重置回最高檔", () => {
    const g = new PerfGovernor();
    g.record({ inferenceMs: 500, fpsMedian: 10 });
    g.reset();
    expect(g.levelId).toBe(0);
  });
});
