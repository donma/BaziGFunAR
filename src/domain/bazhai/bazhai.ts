/**
 * 八宅吉凶對照（後天八卦・版本化）。
 *
 * 來源：大遊年歌（八宅明鏡傳統），以「伏位＋順時針七宮」編碼：
 * 宮位順時針圓序：坎北(0°)、艮東北(45°)、震東(90°)、巽東南(135°)、
 * 離南(180°)、坤西南(225°)、兌西(270°)、乾西北(315°)。
 * 每卦歌訣首字為本宮伏位，其後七字對應順時針下一宮起之七宮。
 *
 * 字義：生=生氣、延=延年、天=天醫、伏=伏位、禍=禍害、六=六煞、五=五鬼、絕=絕命。
 */

export const BAZHAI_TABLE_VERSION = "bazhai-dayou-1.0.0";

export type DirectionDeg = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;

export interface PalaceDef {
  deg: DirectionDeg;
  name: string; // 宮名：坎
  branch: string; // 地支方位標註：北
  shortName: string; // 卦符號文字：☵
  /** 卦象三爻，由下而上，1=陽（實線）0=陰（斷線） */
  lines: [number, number, number];
}

export const PALACES: PalaceDef[] = [
  { deg: 0, name: "坎", branch: "北", shortName: "☵", lines: [0, 1, 0] },
  { deg: 45, name: "艮", branch: "東北", shortName: "☶", lines: [0, 0, 1] },
  { deg: 90, name: "震", branch: "東", shortName: "☳", lines: [1, 0, 0] },
  { deg: 135, name: "巽", branch: "東南", shortName: "☴", lines: [0, 1, 1] },
  { deg: 180, name: "離", branch: "南", shortName: "☲", lines: [1, 0, 1] },
  { deg: 225, name: "坤", branch: "西南", shortName: "☷", lines: [0, 0, 0] },
  { deg: 270, name: "兌", branch: "西", shortName: "☱", lines: [1, 1, 0] },
  { deg: 315, name: "乾", branch: "西北", shortName: "☰", lines: [1, 1, 1] },
];

export type StarKey = "shengQi" | "tianYi" | "yanNian" | "fuWei" | "huoHai" | "liuSha" | "wuGui" | "jueMing";

export interface StarInfo {
  key: StarKey;
  name: string; // 全名
  short: string; // 歌訣字
  luck: "good" | "bad";
  rank: number; // 吉凶強度排序（吉由強到弱，凶由兇到次）
  tone: string; // UI 色調 token
}

/** 四吉：生氣、天醫、延年、伏位；四凶：禍害、六煞、五鬼、絕命 */
export const STARS: Record<StarKey, StarInfo> = {
  shengQi: { key: "shengQi", name: "生氣", short: "生", luck: "good", rank: 1, tone: "good-strong" },
  tianYi: { key: "tianYi", name: "天醫", short: "天", luck: "good", rank: 2, tone: "good-mid" },
  yanNian: { key: "yanNian", name: "延年", short: "延", luck: "good", rank: 3, tone: "good-soft" },
  fuWei: { key: "fuWei", name: "伏位", short: "伏", luck: "good", rank: 4, tone: "good-soft" },
  huoHai: { key: "huoHai", name: "禍害", short: "禍", luck: "bad", rank: 6, tone: "bad-soft" },
  liuSha: { key: "liuSha", name: "六煞", short: "六", luck: "bad", rank: 5, tone: "bad-mid" },
  wuGui: { key: "wuGui", name: "五鬼", short: "五", luck: "bad", rank: 7, tone: "bad-strong" },
  jueMing: { key: "jueMing", name: "絕命", short: "絕", luck: "bad", rank: 8, tone: "bad-strong" },
};

export function isGoodStar(star: StarKey): boolean {
  return STARS[star].luck === "good";
}

const CHAR_TO_STAR: Record<string, StarKey> = {
  生: "shengQi",
  天: "tianYi",
  延: "yanNian",
  伏: "fuWei",
  禍: "huoHai",
  六: "liuSha",
  五: "wuGui",
  絕: "jueMing",
};

/** 大遊年歌：每卦首字為本宮（伏位），其後 7 字依順時針圓序對應。 */
const DAYOU_SONGS: Record<number, string> = {
  6: "伏六天五禍絕延生", // 乾
  1: "伏五天生延絕禍六", // 坎
  8: "伏六絕禍生延天五", // 艮
  3: "伏延生禍絕五天六", // 震
  4: "伏天五六禍生絕延", // 巽
  9: "伏六五絕延禍生天", // 離
  2: "伏天延絕生禍五六", // 坤
  7: "伏生禍延絕六五天", // 兌
};

function palaceIndex(deg: DirectionDeg): number {
  return PALACES.findIndex((p) => p.deg === deg);
}

/** kua 命卦在指定方位（扇區中心角）的吉凶星 */
export function starFor(kua: number, deg: DirectionDeg): StarKey {
  const song = DAYOU_SONGS[kua];
  if (!song) throw new Error(`unknown kua ${kua}`);
  const i0 = palaceIndex(starHomePalaceDeg(kua));
  const iTarget = palaceIndex(deg);
  const step = (iTarget - i0 + 8) % 8;
  const ch = song[step];
  return CHAR_TO_STAR[ch];
}

/** 命卦本宮所在宮位角度（伏位） */
export function starHomePalaceDeg(kua: number): DirectionDeg {
  const map: Record<number, DirectionDeg> = {
    1: 0, 2: 225, 3: 90, 4: 135, 6: 315, 7: 270, 8: 45, 9: 180,
  };
  return map[kua];
}

/** 某命卦的八方完整吉凶表（key 為扇區中心角度） */
export function bazhaiWheel(kua: number): Record<DirectionDeg, StarKey> {
  const wheel = {} as Record<DirectionDeg, StarKey>;
  for (const p of PALACES) {
    wheel[p.deg] = starFor(kua, p.deg);
  }
  return wheel;
}

/** 角度 → 扇區中心角（45° 扇區，邊界 22.5° 奇數倍） */
export function sectorCenterDeg(deg: number): DirectionDeg | null {
  if (!Number.isFinite(deg)) return null;
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.floor(((norm + 22.5) % 360) / 45);
  return PALACES[idx].deg;
}

/** 距扇區邊界的角距離（0 = 正落在 22.5° 邊界上） */
export function boundaryDistanceDeg(deg: number): number {
  const norm = ((deg % 360) + 360) % 360;
  const within = norm % 45;
  const d = Math.min(within, 45 - within); // 距扇區中心 0–22.5
  return 22.5 - d;
}

export const BOUNDARY_WARN_DEG = 2; // 距邊界 ≤2° 提示交界
