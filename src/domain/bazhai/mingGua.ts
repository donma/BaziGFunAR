/**
 * 命卦引擎（傳統八宅・版本化）。
 *
 * 年界：立春交節時刻（天文計算，見 lichun.ts），出生時間以 Asia/Taipei（UTC+8）解讀。
 * 男女命卦採通用數字縮減法（1900–2100 有效），五黃命寄宮：男寄坤二、女寄艮八。
 * 集中版本化，UI 不得自行硬編碼結果。
 */

import { getLichunInstant } from "./lichun";

export const MING_GUA_ENGINE_VERSION = "minggua-bazhai-1.0.0";

export type Sex = "male" | "female";

export type KuaNumber = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9;

export interface BirthInput {
  /** 國曆 YYYY-MM-DD */
  birthDate: string;
  /** 選填 HH:mm（24 小時制） */
  birthTime?: string | null;
  sex: Sex;
}

export interface MingGuaResult {
  kua: KuaNumber;
  /** 五黃命（原計算值為 5，寄宮後為實際卦）標記 */
  isWuHuang: boolean;
  /** 年界判定是否依賴選填時間（立春臨界且未提供時間） */
  boundaryUncertain: boolean;
  /** 採用的立春年（出生年份或前一年） */
  guaYear: number;
}

/** 數字根：連續位數縮減至單一位數 */
function digitSumOnce(n: number): number {
  let s = 0;
  const str = String(n);
  for (const ch of str) s += Number(ch);
  return s;
}

function reduceToSingleDigit(n: number): number {
  while (n > 9) n = digitSumOnce(n);
  return n;
}

/**
 * 計算命卦。
 * 演算法（等價於傳統男女命卦歌訣，1900–2100）：
 * 男：(11 - 年份位數和縮減) mod 9 歸 1..9；女：(4 + 年份位數和縮減) mod 9 歸 1..9。
 * 值 5 為五黃：男寄坤 2、女寄艮 8。
 */
export function computeMingGua(input: BirthInput): MingGuaResult {
  const { birthDate, sex } = input;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) throw new Error("birthDate must be YYYY-MM-DD");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100) throw new Error("birth year out of supported range 1900–2100");

  // 出生瞬間（Asia/Taipei UTC+8 解讀；未提供時間以 12:00 為名義值）
  let birthMs: number;
  let hasTime = false;
  if (input.birthTime && /^\d{2}:\d{2}$/.exec(input.birthTime)) {
    hasTime = true;
    const [hh, mm] = input.birthTime.split(":").map(Number);
    birthMs = Date.UTC(y, mo - 1, d, hh - 8, mm, 0);
  } else {
    birthMs = Date.UTC(y, mo - 1, d, 12 - 8, 0, 0);
  }

  // 立春年界
  const lichunThisYear = getLichunInstant(y).date.getTime();
  const guaYear = birthMs >= lichunThisYear ? y : y - 1;

  // 立春臨界且缺時間 → 提示不確定（不靜默猜測）
  let boundaryUncertain = false;
  if (!hasTime) {
    const dayStartMs = Date.UTC(y, mo - 1, d, 0 - 8, 0, 0);
    const dayEndMs = dayStartMs + 24 * 3600000;
    const lc = lichunThisYear;
    // 出生日即立春當日（台北日期），或出生日的前後一日內有交節且跨日界
    const lcLocalDay = taipeiDateKey(lc);
    if (lcLocalDay === birthDate) boundaryUncertain = true;
    // 交節於出生日 00:00 前後 ±24h 內亦視為臨界
    if (Math.abs(lc - dayStartMs) < 24 * 3600000 && Math.abs(lc - dayEndMs) < 48 * 3600000) {
      boundaryUncertain = true;
    }
  }

  const s = reduceToSingleDigit(guaYear);
  let raw: number;
  if (sex === "male") {
    raw = 11 - s;
    raw = ((raw - 1) % 9 + 9) % 9 + 1; // 歸 1..9
  } else {
    raw = 4 + s;
    raw = ((raw - 1) % 9 + 9) % 9 + 1;
  }

  const isWuHuang = raw === 5;
  const kua = (isWuHuang ? (sex === "male" ? 2 : 8) : raw) as KuaNumber;

  return { kua, isWuHuang, boundaryUncertain, guaYear };
}

function taipeiDateKey(ms: number): string {
  const d = new Date(ms + 8 * 3600000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface KuaInfo {
  kua: KuaNumber;
  name: string; // 坎/坤/震/巽/乾/兌/艮/離
  element: string; // 五行
  group: "east4" | "west4"; // 東四命／西四命
  trigramLines: [number, number, number]; // 由下而上，1=陽 0=陰
}

export const KUA_TABLE: Record<KuaNumber, KuaInfo> = {
  1: { kua: 1, name: "坎", element: "水", group: "east4", trigramLines: [0, 1, 0] },
  2: { kua: 2, name: "坤", element: "土", group: "west4", trigramLines: [0, 0, 0] },
  3: { kua: 3, name: "震", element: "木", group: "east4", trigramLines: [1, 0, 0] },
  4: { kua: 4, name: "巽", element: "木", group: "east4", trigramLines: [0, 1, 1] },
  6: { kua: 6, name: "乾", element: "金", group: "west4", trigramLines: [1, 1, 1] },
  7: { kua: 7, name: "兌", element: "金", group: "west4", trigramLines: [1, 1, 0] },
  8: { kua: 8, name: "艮", element: "土", group: "west4", trigramLines: [0, 0, 1] },
  9: { kua: 9, name: "離", element: "火", group: "east4", trigramLines: [1, 0, 1] },
};

const STEM = "甲乙丙丁戊己庚辛壬癸";
const BRANCH = "子丑寅卯辰巳午未申酉戌亥";

/** 西元年 → 干支年（如 1991 → 辛未） */
export function ganzhiYear(year: number): string {
  const i = (((year - 4) % 10) + 10) % 10;
  const j = (((year - 4) % 12) + 12) % 12;
  return `${STEM[i]}${BRANCH[j]}`;
}

/** 卦數的中文數字（乾六、坎一…；無五，五黃已寄宮） */
export const KUA_NUMERAL: Record<KuaNumber, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  6: "六",
  7: "七",
  8: "八",
  9: "九",
};

/** 完整命卦稱呼：如「乾六命」 */
export function kuaTitle(kua: KuaNumber): string {
  return `${KUA_TABLE[kua].name}${KUA_NUMERAL[kua]}命`;
}
