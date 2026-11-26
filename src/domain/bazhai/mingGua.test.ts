import { describe, it, expect } from "vitest";
import { computeMingGua, KUA_TABLE, ganzhiYear, kuaTitle } from "./mingGua";
import { bazhaiWheel, starFor, PALACES, sectorCenterDeg, boundaryDistanceDeg, isGoodStar } from "./bazhai";
import type { StarKey } from "./bazhai";

describe("命卦計算", () => {
  // 人工核對測試表（傳統八宅，立春年界，Asia/Taipei UTC+8）
  // 公式：男＝11−(guaYear 位數和縮減)、女＝4＋(guaYear 位數和縮減)，歸 1–9；五黃男寄坤2／女寄艮8。
  const cases: Array<[string, "male" | "female", string | null, number, string]> = [
    // [日期, 性別, 時間, 期望卦數, 卦名]
    ["1990-05-12", "female", null, 8, "艮"], // 1990 女：4+(1+9+9+0=19→1)=5 → 五黃寄艮8
    ["1990-05-12", "male", null, 1, "坎"], // 1990 男：19→1，11−1=10→1 坎
    ["1980-01-15", "male", null, 3, "震"], // 立春前（己未 1979）：1979→26→8，11−8=3 震
    ["1995-06-01", "male", null, 2, "坤"], // 1995 男五黃寄坤
    ["1995-06-01", "female", null, 1, "坎"], // 1995 女：4+(24→6)=10→1 坎
    ["2000-02-04", "male", "18:00", 9, "離"], // 2000 立春（16:26:53）後 → 庚辰男：2000→2，11−2=9 離
    ["2000-02-04", "male", "08:00", 1, "坎"], // 立春前 → 己卯男：1999→28→1，11−1=10→1 坎
    ["1984-06-15", "female", null, 8, "艮"], // 1984 女：4+(22→4)=8 艮
    ["1962-08-08", "male", null, 2, "坤"], // 1962 男：18→9，11−9=2 坤
  ];

  it("人工核對表（卦數）", () => {
    for (const [date, sex, time, expKua] of cases) {
      const r = computeMingGua({ birthDate: date, birthTime: time, sex });
      expect(r.kua, `${date} ${sex} ${time}`).toBe(expKua);
    }
  });

  it("1990 女命＝五黃寄艮 8", () => {
    const r = computeMingGua({ birthDate: "1990-05-12", birthTime: null, sex: "female" });
    expect(r.isWuHuang).toBe(true);
    expect(r.kua).toBe(8);
    expect(KUA_TABLE[8].name).toBe("艮");
  });

  it("1990 男命＝坎 1（11−(19→1)=10→1）", () => {
    const r = computeMingGua({ birthDate: "1990-05-12", birthTime: null, sex: "male" });
    expect(r.kua).toBe(1);
    expect(KUA_TABLE[1].name).toBe("坎");
  });

  it("1995 男五黃寄坤 2／女坎 1", () => {
    const male = computeMingGua({ birthDate: "1995-06-01", birthTime: null, sex: "male" });
    expect(male.isWuHuang).toBe(true);
    expect(male.kua).toBe(2);
    const female = computeMingGua({ birthDate: "1995-06-01", birthTime: null, sex: "female" });
    expect(female.isWuHuang).toBe(false);
    expect(female.kua).toBe(1);
    expect(KUA_TABLE[female.kua].name).toBe("坎");
  });

  it("立春臨界無時間 → boundaryUncertain 提示（不靜默猜測）", () => {
    // 2026 立春：2026-02-04 04:01:51 CST。當日出生無時間 → 不確定
    const r = computeMingGua({ birthDate: "2026-02-04", birthTime: null, sex: "male" });
    expect(r.boundaryUncertain).toBe(true);
    // 有時間（06:00，立春後）→ 確定
    const r2 = computeMingGua({ birthDate: "2026-02-04", birthTime: "06:00", sex: "male" });
    expect(r2.boundaryUncertain).toBe(false);
    expect(r2.guaYear).toBe(2026);
    // 立春前 02:00 → 屬前一年
    const r3 = computeMingGua({ birthDate: "2026-02-04", birthTime: "02:00", sex: "male" });
    expect(r3.guaYear).toBe(2025);
  });

  it("全部八個卦皆可被產生", () => {
    const seen = new Set<number>();
    for (let y = 1900; y <= 2100; y++) {
      for (const sex of ["male", "female"] as const) {
        const r = computeMingGua({ birthDate: `${y}-06-15`, birthTime: null, sex });
        seen.add(r.kua);
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  });

  it("東四命／西四命分組正確", () => {
    expect(KUA_TABLE[1].group).toBe("east4");
    expect(KUA_TABLE[3].group).toBe("east4");
    expect(KUA_TABLE[4].group).toBe("east4");
    expect(KUA_TABLE[9].group).toBe("east4");
    expect(KUA_TABLE[2].group).toBe("west4");
    expect(KUA_TABLE[6].group).toBe("west4");
    expect(KUA_TABLE[7].group).toBe("west4");
    expect(KUA_TABLE[8].group).toBe("west4");
  });
});

describe("干支年與命卦稱呼", () => {
  it("干支年（對照萬年曆）", () => {
    expect(ganzhiYear(1984)).toBe("甲子");
    expect(ganzhiYear(1991)).toBe("辛未");
    expect(ganzhiYear(2000)).toBe("庚辰");
    expect(ganzhiYear(2026)).toBe("丙午");
  });

  it("命卦稱呼使用中文數字（乾六命）", () => {
    expect(kuaTitle(6)).toBe("乾六命");
    expect(kuaTitle(1)).toBe("坎一命");
    expect(kuaTitle(2)).toBe("坤二命");
    expect(kuaTitle(9)).toBe("離九命");
  });

  it("1991 女命＝乾六命・西四命・金・計算年 1991（對照參考畫面）", () => {
    const r = computeMingGua({ birthDate: "1991-06-15", birthTime: null, sex: "female" });
    expect(r.guaYear).toBe(1991);
    expect(kuaTitle(r.kua)).toBe("乾六命");
    expect(KUA_TABLE[r.kua].group).toBe("west4");
    expect(KUA_TABLE[r.kua].element).toBe("金");
  });
});

describe("八宅大遊年對照", () => {
  it("乾命八方與參考畫面一致（西北伏位吉、北六煞凶、東北天醫吉、西生氣吉、東五鬼凶、西南延年吉、南絕命凶、東南禍害凶）", () => {
    const w = bazhaiWheel(6);
    const expected: Array<[number, string, boolean]> = [
      [315, "fuWei", true],
      [0, "liuSha", false],
      [45, "tianYi", true],
      [270, "shengQi", true],
      [90, "wuGui", false],
      [225, "yanNian", true],
      [180, "jueMing", false],
      [135, "huoHai", false],
    ];
    for (const [deg, star, good] of expected) {
      expect(w[deg as 0], `deg ${deg}`).toBe(star);
      expect(isGoodStar(w[deg as 0]), `deg ${deg} luck`).toBe(good);
    }
  });

  it("卦象三爻與命卦表一致，且八卦互異", () => {
    const byName = Object.fromEntries(Object.values(KUA_TABLE).map((k) => [k.name, k.trigramLines]));
    const seen = new Set<string>();
    for (const p of PALACES) {
      expect(p.lines, `${p.name} 卦象`).toEqual(byName[p.name]);
      seen.add(p.lines.join(""));
    }
    expect(seen.size).toBe(8);
  });
  // 乾命（6）大遊年歌：乾六天五禍絕延生
  // 宮序（自乾西北順時針）：乾→坎→艮→震→巽→離→坤→兌
  // 乾命本宮圓序（自乾起順時針）：乾→坎→艮→震→巽→離→坤→兌
  // ＝大遊年歌：乾六天五禍絕延生 → 伏六天五禍絕延生
  it("乾命八方吉凶（本宮圓序＝大遊年歌）", () => {
    const w = bazhaiWheel(6);
    expect(w[315]).toBe("fuWei"); // 乾：伏位
    expect(w[0]).toBe("liuSha"); // 坎：六煞
    expect(w[45]).toBe("tianYi"); // 艮：天醫
    expect(w[90]).toBe("wuGui"); // 震：五鬼
    expect(w[135]).toBe("huoHai"); // 巽：禍害
    expect(w[180]).toBe("jueMing"); // 離：絕命
    expect(w[225]).toBe("yanNian"); // 坤：延年
    expect(w[270]).toBe("shengQi"); // 兌：生氣
  });

  it("坎命八方吉凶", () => {
    const w = bazhaiWheel(1);
    expect(w[0]).toBe("fuWei"); // 坎伏位
    // 坎五天生延絕禍六：艮(45)=五鬼, 震(90)=天醫, 巽(135)=生氣, 離(180)=延年, 坤(225)=絕命, 兌(270)=禍害, 乾(315)=六煞
    expect(w[45]).toBe("wuGui");
    expect(w[90]).toBe("tianYi");
    expect(w[135]).toBe("shengQi");
    expect(w[180]).toBe("yanNian");
    expect(w[225]).toBe("jueMing");
    expect(w[270]).toBe("huoHai");
    expect(w[315]).toBe("liuSha");
  });

  it("每命八方完整且吉凶皆來自八星", () => {
    const valid: StarKey[] = ["shengQi", "tianYi", "yanNian", "fuWei", "huoHai", "liuSha", "wuGui", "jueMing"];
    for (const kua of [1, 2, 3, 4, 6, 7, 8, 9]) {
      const w = bazhaiWheel(kua);
      for (const p of PALACES) {
        expect(valid).toContain(w[p.deg]);
      }
      // 每命必含四吉（伏位＋三吉）與四凶
      const vals = Object.values(w);
      expect(vals.filter((v) => ["shengQi", "tianYi", "yanNian", "fuWei"].includes(v)).length).toBe(4);
      expect(vals.filter((v) => ["huoHai", "liuSha", "wuGui", "jueMing"].includes(v)).length).toBe(4);
    }
  });
});

describe("扇區映射", () => {
  it("8/8 中心方位正確", () => {
    expect(sectorCenterDeg(0)).toBe(0);
    expect(sectorCenterDeg(45)).toBe(45);
    expect(sectorCenterDeg(90)).toBe(90);
    expect(sectorCenterDeg(135)).toBe(135);
    expect(sectorCenterDeg(180)).toBe(180);
    expect(sectorCenterDeg(225)).toBe(225);
    expect(sectorCenterDeg(270)).toBe(270);
    expect(sectorCenterDeg(315)).toBe(315);
    // 359 距 315 中心較遠（337.5–22.5 扇區屬 0°）
    expect(sectorCenterDeg(359)).toBe(0);
    expect(sectorCenterDeg(1)).toBe(0);
    expect(sectorCenterDeg(44)).toBe(45);
  });

  it("邊界 ±epsilon", () => {
    expect(sectorCenterDeg(22.5 - 0.001)).toBe(0);
    expect(sectorCenterDeg(22.5 + 0.001)).toBe(45);
    expect(sectorCenterDeg(337.5 + 0.001)).toBe(0);
    expect(sectorCenterDeg(337.5 - 0.001)).toBe(315);
  });

  it("邊界距離", () => {
    expect(boundaryDistanceDeg(0)).toBe(22.5);
    expect(boundaryDistanceDeg(22.5)).toBe(0);
    expect(boundaryDistanceDeg(20)).toBeCloseTo(2.5);
    expect(boundaryDistanceDeg(25)).toBeCloseTo(2.5);
    expect(boundaryDistanceDeg(45)).toBe(22.5);
    expect(boundaryDistanceDeg(47)).toBeCloseTo(20.5);
  });
});
