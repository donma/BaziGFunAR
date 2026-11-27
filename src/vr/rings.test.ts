import { describe, it, expect } from "vitest";
import { BRANCHES_12, MOUNTAINS_24, ringBranches, ringMountains, ringTrigrams } from "./rings";

describe("羅盤文字圈資料", () => {
  it("二十四山共 24 個、不重複、每 15°", () => {
    const m = ringMountains();
    expect(m).toHaveLength(24);
    expect(new Set(m.map((x) => x.ch)).size).toBe(24);
    m.forEach((x, i) => expect(x.deg).toBe(i * 15));
  });

  it("子在正北、午在正南、卯在正東、酉在正西", () => {
    const at = (deg: number) => ringMountains().find((x) => x.deg === deg)?.ch;
    expect(at(0)).toBe("子");
    expect(at(180)).toBe("午");
    expect(at(90)).toBe("卯");
    expect(at(270)).toBe("酉");
  });

  it("二十四山的四個卦位與後天八卦一致（艮45 巽135 坤225 乾315）", () => {
    const at = (deg: number) => ringMountains().find((x) => x.deg === deg)?.ch;
    expect(at(45)).toBe("艮");
    expect(at(135)).toBe("巽");
    expect(at(225)).toBe("坤");
    expect(at(315)).toBe("乾");
  });

  it("十二地支每 30°，且與二十四山同角度的字相同", () => {
    const b = ringBranches();
    expect(b).toHaveLength(12);
    const mount = ringMountains();
    for (const x of b) expect(mount.find((m) => m.deg === x.deg)?.ch).toBe(x.ch);
    expect(BRANCHES_12.every((c) => MOUNTAINS_24.includes(c))).toBe(true);
  });

  it("卦名對應後天八卦方位（坎北 艮東北 震東 巽東南 離南 坤西南 兌西 乾西北）", () => {
    const t = Object.fromEntries(ringTrigrams().map((x) => [x.ch, x.deg]));
    expect(t).toEqual({ 坎: 0, 艮: 45, 震: 90, 巽: 135, 離: 180, 坤: 225, 兌: 270, 乾: 315 });
  });
});
