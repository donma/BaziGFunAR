import { describe, it, expect } from "vitest";
import { lichunInstantUTC, LICHUN_ANCHORS, lichunLocalDateString, getLichunInstant } from "./lichun";

describe("立春天文計算", () => {
  it("錨點年份誤差 < 600 秒（低階理論精度；近年由 LICHUN_OVERRIDES 覆寫為 0 誤差）", () => {
    for (const a of LICHUN_ANCHORS) {
      const calc = lichunInstantUTC(a.year);
      const expectMs = Date.parse(a.utc);
      const diff = Math.abs(calc.getTime() - expectMs) / 1000;
      expect(diff).toBeLessThan(600);
    }
  });

  it("近年覆寫值與天文機構公布值一致（0 誤差）", () => {
    for (const a of LICHUN_ANCHORS) {
      const g = getLichunInstant(a.year);
      expect(g.source).toBe("verified");
      expect(g.date.getTime()).toBe(Date.parse(a.utc));
    }
  });

  it("每年立春落在 2/3–2/5 之間", () => {
    for (const y of [1950, 1990, 2000, 2020, 2050, 2099]) {
      const d = lichunInstantUTC(y);
      const ms = d.getTime();
      const lo = Date.UTC(y, 1, 2, 0, 0, 0);
      const hi = Date.UTC(y, 1, 6, 0, 0, 0);
      expect(ms).toBeGreaterThan(lo);
      expect(ms).toBeLessThan(hi);
    }
  });

  it("2026 立春在台北 2/4", () => {
    expect(lichunLocalDateString(2026)).toBe("2026-02-04");
  });

  it("2000 立春在台北 2/4", () => {
    expect(lichunLocalDateString(2000)).toBe("2000-02-04");
  });
});
