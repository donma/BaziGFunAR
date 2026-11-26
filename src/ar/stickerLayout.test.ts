import { describe, it, expect } from "vitest";
import { planLayout, selectCards, dedupeSameSector, cardRect, MAX_CARDS } from "./stickerLayout";
import type { StickerInput } from "./stickerLayout";
import type { Track } from "../tracking/tracker";
import type { SpatialResult } from "./spatial";

function track(id: number, kind: string, box: { x: number; y: number; w: number; h: number }, score = 0.8, source: "model" | "geo" = "model"): Track {
  return {
    id, kind, source, score, box,
    vel: { vx: 0, vy: 0 }, state: "active", missed: 0,
    firstTs: 0, lastTs: 0, userOffset: { dx: 0, dy: 0 },
    confirmed: source === "model", rejected: false,
  };
}

function spatial(status: SpatialResult["status"] = "heading-ref", sector = 315, star = "fuWei"): SpatialResult {
  return {
    status, bearingDeg: status === "pending" ? null : 315, sector: status === "pending" ? null : (sector as never),
    palace: "乾", palaceBranch: "西北", star: status === "pending" ? null : (star as never),
    isGood: true, nearBoundary: false, angularOffsetDeg: 0,
  };
}

const VIEW_W = 390;
const VIEW_H = 844;

describe("Sticker 版面（規格 8）", () => {
  it("上限 4 張卡片", () => {
    const inputs: StickerInput[] = [];
    const kinds = ["bed", "sofa", "table", "chair", "tv", "fridge"];
    kinds.forEach((k, i) => {
      inputs.push({
        track: track(i + 1, k, { x: i * 0.16, y: 0.3, w: 0.14, h: 0.2 }, 0.9),
        spatial: spatial("heading-ref", (315 - i * 45) % 360 as never, undefined as never),
        areaFrac: 0.03,
      });
    });
    const chosen = selectCards(inputs);
    expect(chosen.size).toBe(MAX_CARDS);
  });

  it("同扇區同吉凶去重：第二個降為僅光框", () => {
    const inputs: StickerInput[] = [
      { track: track(1, "bed", { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, 0.95), spatial: spatial(), areaFrac: 0.04 },
      { track: track(2, "sofa", { x: 0.4, y: 0.5, w: 0.2, h: 0.2 }, 0.9), spatial: spatial(), areaFrac: 0.04 },
    ];
    const out = planLayout(inputs, VIEW_W, VIEW_H);
    expect(out.find((p) => p.trackId === 1)?.showCard).toBe(true);
    expect(out.find((p) => p.trackId === 2)?.showCard).toBe(false); // 同 315/fuWei → 去重
  });

  it("卡片矩形重疊 → 後者降為僅光框（自動避讓）", () => {
    const inputs: StickerInput[] = [
      { track: track(1, "bed", { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, 0.95), spatial: spatial("heading-ref", 315), areaFrac: 0.04 },
      { track: track(2, "sofa", { x: 0.13, y: 0.2, w: 0.2, h: 0.2 }, 0.85), spatial: spatial("heading-ref", 0), areaFrac: 0.04 },
    ];
    const out = planLayout(inputs, VIEW_W, VIEW_H);
    expect(out.find((p) => p.trackId === 1)?.showCard).toBe(true);
    expect(out.find((p) => p.trackId === 2)?.showCard).toBe(false);
  });

  it("卡片高度自適應且有上下限（≥44px 觸控區）", () => {
    const small = { track: track(1, "chair", { x: 0.1, y: 0.5, w: 0.08, h: 0.06 }), spatial: spatial(), areaFrac: 0.005 };
    const big = { track: track(2, "bed", { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }), spatial: spatial(), areaFrac: 0.3 };
    const hSmall = cardRect(small, VIEW_H).h * VIEW_H;
    const hBig = cardRect(big, VIEW_H).h * VIEW_H;
    expect(hSmall).toBeGreaterThanOrEqual(44);
    expect(hBig).toBeLessThanOrEqual(88);
    expect(hBig).toBeGreaterThan(hSmall);
  });

  it("pending 幾何候選也佔一張卡（淡金色待確認）", () => {
    const inputs: StickerInput[] = [
      { track: track(1, "door", { x: 0.3, y: 0.2, w: 0.2, h: 0.5 }, 0.6, "geo"), spatial: spatial("pending"), areaFrac: 0.1 },
    ];
    const out = planLayout(inputs, VIEW_W, VIEW_H);
    expect(out.length).toBe(1);
    expect(out[0].showCard).toBe(true);
  });
});

describe("去重工具", () => {
  it("dedupeSameSector：同 key 只留第一個", () => {
    const inputs: StickerInput[] = [
      { track: track(1, "bed", { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }), spatial: spatial("heading-ref", 315, "fuWei"), areaFrac: 0.04 },
      { track: track(2, "sofa", { x: 0.5, y: 0.6, w: 0.2, h: 0.2 }), spatial: spatial("heading-ref", 315, "fuWei"), areaFrac: 0.04 },
      { track: track(3, "table", { x: 0.1, y: 0.7, w: 0.2, h: 0.2 }), spatial: spatial("heading-ref", 0, "liuSha"), areaFrac: 0.04 },
    ];
    const chosen = new Set([1, 2, 3]);
    const out = dedupeSameSector(inputs, chosen);
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(false);
    expect(out.has(3)).toBe(true);
  });
});
