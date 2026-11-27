/**
 * 羅盤文字圈資料（只放能真實推出的羅盤／八宅資料，不放奇門術語）。
 *
 * - 二十四山：每山 15°，子在正北 0°，順時針；八卦位（艮巽坤乾）落在 45°／135°／225°／315°。
 * - 十二地支：每支 30°，子在正北。
 * - 卦名：後天八卦方位（與 bazhai.ts 的 PALACES 一致）。
 */
import { PALACES, type DirectionDeg } from "../domain/bazhai/bazhai";

export const MOUNTAINS_24 = [
  "子", "癸", "丑", "艮", "寅", "甲", "卯", "乙", "辰", "巽", "巳", "丙",
  "午", "丁", "未", "坤", "申", "庚", "酉", "辛", "戌", "乾", "亥", "壬",
] as const;

export const BRANCHES_12 = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;

export interface RingGlyph {
  ch: string;
  deg: number;
}

/** 二十四山：每 15° 一山 */
export function ringMountains(): RingGlyph[] {
  return MOUNTAINS_24.map((ch, i) => ({ ch, deg: i * 15 }));
}

/** 十二地支：每 30° 一支 */
export function ringBranches(): RingGlyph[] {
  return BRANCHES_12.map((ch, i) => ({ ch, deg: i * 30 }));
}

/** 八卦名與其方位角 */
export function ringTrigrams(): Array<{ ch: string; deg: DirectionDeg }> {
  return PALACES.map((p) => ({ ch: p.name, deg: p.deg }));
}

/**
 * 二十四節氣：依太陽黃經排在羅盤上，冬至在正北（子），每 15° 一氣順時針。
 * 錨點：冬至 0°（子）、立春 45°（艮）、春分 90°（卯）、立夏 135°（巽）、夏至 180°（午）、
 * 立秋 225°（坤）、秋分 270°（酉）、立冬 315°（乾）。這圈是羅盤的傳統圖案，僅作節氣意象。
 */
export const SOLAR_TERMS_24 = [
  "冬至", "小寒", "大寒", "立春", "雨水", "驚蟄", "春分", "清明", "穀雨", "立夏", "小滿", "芒種",
  "夏至", "小暑", "大暑", "立秋", "處暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪",
] as const;

export function ringSolarTerms(): RingGlyph[] {
  return SOLAR_TERMS_24.map((ch, i) => ({ ch, deg: i * 15 }));
}
