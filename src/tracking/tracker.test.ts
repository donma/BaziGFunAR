import { describe, it, expect, beforeEach } from "vitest";
import { Tracker, iou, boxCenter, resetTrackerIds, type Detection } from "./tracker";

function det(kind: string, x: number, y: number, w: number, h: number, score = 0.8, source: "model" | "geo" = "model"): Detection {
  return { kind, score, box: { x, y, w, h }, source };
}

beforeEach(() => resetTrackerIds());

describe("IoU 與中心", () => {
  it("相同框 IoU=1；不相交 IoU=0", () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.6, y: 0.6, w: 0.3, h: 0.3 })).toBe(0);
  });
  it("中心計算", () => {
    const c = boxCenter({ x: 0.2, y: 0.3, w: 0.2, h: 0.2 });
    expect(c.cx).toBeCloseTo(0.3);
    expect(c.cy).toBeCloseTo(0.4);
  });
});

describe("追蹤器", () => {
  it("同一物件連續偵測保持同一 ID，且位置平滑（不瞬間跳動）", () => {
    const tr = new Tracker();
    const t1 = tr.update([det("bed", 0.1, 0.1, 0.3, 0.2)], 0, 100);
    expect(t1.length).toBe(1);
    const id = t1[0].id;
    const t2 = tr.update([det("bed", 0.2, 0.1, 0.3, 0.2)], 100, 100);
    expect(t2.length).toBe(1);
    expect(t2[0].id).toBe(id);
    // posAlpha 0.55：x 應在 0.1 與 0.2 之間（0.155）
    expect(t2[0].box.x).toBeGreaterThan(0.1);
    expect(t2[0].box.x).toBeLessThan(0.2);
  });

  it("偵測消失 → fading → gone（不沿用過時位置宣稱有效）", () => {
    const tr = new Tracker({ fadeMs: 500, maxMissed: 3 });
    let ts = 0;
    let tracks = tr.update([det("sofa", 0.2, 0.2, 0.4, 0.3)], ts, 100);
    expect(tracks[0].state).toBe("active");
    tracks = tr.update([], (ts += 100), 100);
    expect(tracks[0].state).toBe("fading");
    // fading 逾時移除：maxMissed=3 次未匹配，或超過 fadeMs+400
    tracks = tr.update([], (ts += 1100), 100);
    expect(tracks.length).toBe(0);
  });

  it("短暫遮擋（1–2 次未匹配）內恢復 → 同 ID 繼續", () => {
    const tr = new Tracker();
    let ts = 0;
    let tracks = tr.update([det("table", 0.1, 0.2, 0.4, 0.3)], ts, 100);
    const id = tracks[0].id;
    tr.update([], (ts += 100), 100); // 遮擋
    tracks = tr.update([det("table", 0.11, 0.2, 0.4, 0.3)], (ts += 100), 100);
    expect(tracks.length).toBe(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].state).toBe("active");
  });

  it("超出 maxTracks 時保留分數最高者", () => {
    const tr = new Tracker();
    const dets = [
      det("bed", 0.02, 0.1, 0.2, 0.2, 0.95),
      det("sofa", 0.3, 0.1, 0.2, 0.2, 0.9),
      det("table", 0.6, 0.1, 0.2, 0.2, 0.5),
    ];
    const tracks = tr.update(dets, 0, 100, 2);
    expect(tracks.length).toBe(2);
    const kinds = tracks.map((t) => t.kind).sort();
    expect(kinds).toEqual(["bed", "sofa"]);
  });

  it("同類重疊新偵測配對既有追蹤，不會重複開追蹤", () => {
    const tr = new Tracker();
    let ts = 0;
    let tracks = tr.update([det("bed", 0.1, 0.1, 0.3, 0.3)], ts, 100);
    tracks = tr.update([det("bed", 0.12, 0.11, 0.3, 0.3)], (ts += 100), 100);
    expect(tracks.length).toBe(1);
  });

  it("確認／否決幾何候選", () => {
    const tr = new Tracker();
    const tracks = tr.update([det("door", 0.3, 0.2, 0.15, 0.4, 0.6, "geo")], 0, 100);
    const id = tracks[0].id;
    expect(tracks[0].confirmed).toBe(false);
    tr.confirm(id, "window");
    expect(tr.find(id)?.kind).toBe("window");
    expect(tr.find(id)?.confirmed).toBe(true);
    tr.reject(id);
    const after = tr.update([], 100, 100);
    expect(after.length).toBe(0);
  });

  it("使用者拖曳偏移累加", () => {
    const tr = new Tracker();
    const tracks = tr.update([det("bed", 0.1, 0.1, 0.3, 0.3)], 0, 100);
    tr.nudge(tracks[0].id, 0.05, -0.02);
    tr.nudge(tracks[0].id, 0.05, -0.02);
    const t = tr.find(tracks[0].id)!;
    expect(t.userOffset.dx).toBeCloseTo(0.1);
    expect(t.userOffset.dy).toBeCloseTo(-0.04);
  });

  it("新追蹤上限：超過 maxTracks 的未匹配偵測不開新檔", () => {
    const tr = new Tracker();
    const dets = [
      det("bed", 0.0, 0.0, 0.2, 0.2, 0.9),
      det("sofa", 0.25, 0.0, 0.2, 0.2, 0.85),
      det("table", 0.5, 0.0, 0.2, 0.2, 0.8),
      det("chair", 0.75, 0.0, 0.2, 0.2, 0.75),
    ];
    const tracks = tr.update(dets, 0, 100, 3);
    expect(tracks.length).toBe(3);
  });
});
