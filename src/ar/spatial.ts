/**
 * 空間解讀（規格 7：嚴格區分四種資料，誠實標示）。
 *
 * - 手機鏡頭朝向：由感測引擎（heading）提供。
 * - 物件影像位置：偵測框（不冒充 3D 空間位置）。
 * - 住宅空間位置：僅在「使用者確認站於住宅中心＋感測 valid＋遠離扇區交界」時，
 *   以鏡頭朝向（含畫面角位移概估）推得物件方位，標示「住宅宮位已確認」。
 * - 八宅吉凶：由命卦＋大遊年計算，不是物件分類器產生。
 *
 * 標籤狀態（決策 25A）：
 * - confirmed-home：「{星}方 · 住宅宮位已確認」
 * - heading-ref：「{星}方 · 朝向參考」（預設一般模式）
 * - pending：資料不足 → 淡金色待確認（或直接隱藏，由 UI 決定）
 */

import { PALACES, boundaryDistanceDeg, sectorCenterDeg, BOUNDARY_WARN_DEG, isGoodStar, type StarKey, type DirectionDeg } from "../domain/bazhai/bazhai";
import type { Quality } from "../domain/compass/heading";

export interface SpatialContext {
  /** 感測顯示方位（已含校正與磁偏角） */
  headingDeg: number | null;
  quality: Quality;
  tiltDegraded: boolean;
  /** 使用者確認站在住宅幾何中心 */
  homeAtCenter: boolean;
  /** 人物命卦的八方吉凶表 */
  wheel: Record<DirectionDeg, StarKey> | null;
}

export type LabelStatus = "confirmed-home" | "heading-ref" | "pending";

export const ASSUMED_HFOV_DEG = 62; // 主流手機後鏡頭水平視角概估值；僅用於畫面角位移推估，介面標明為概估

export interface SpatialInput {
  /** 感測顯示方位（已含校正/磁偏角）；null＝無方位 */
  headingDeg: number | null;
  quality: Quality;
  tiltDegraded: boolean;
  /** 使用者已確認站在住宅幾何中心 */
  homeAtCenter: boolean;
  /** 偵測框中心在畫面中的水平位置（0–1） */
  boxCenterXNorm: number;
  /** 偵測框是否已被確認（幾何候選未確認 → 一律 pending） */
  confirmed: boolean;
}

export interface SpatialResult {
  status: LabelStatus;
  /** 朝向參考／已確認下的方位角（0–360）；pending 為 null */
  bearingDeg: number | null;
  sector: DirectionDeg | null;
  palace: string | null;
  palaceBranch: string | null;
  star: StarKey | null;
  isGood: boolean | null;
  nearBoundary: boolean;
  /** 概估的畫面角位移（度） */
  angularOffsetDeg: number;
}

/**
 * 由方位引擎輸出＋物件框位置推得物件方位解讀。
 * wheel：該人物命卦的八方吉凶表。
 */
export function interpret(
  input: SpatialInput,
  wheel: Record<DirectionDeg, StarKey> | null,
  opts: { assumedHfovDeg?: number; nowBoundary?: number } = {},
): SpatialResult {
  const hfov = opts.assumedHfovDeg ?? ASSUMED_HFOV_DEG;
  const offset = (input.boxCenterXNorm - 0.5) * hfov;

  const headingOk =
    input.headingDeg !== null &&
    input.quality !== "unavailable" &&
    !input.tiltDegraded;

  const bearingDeg = input.headingDeg !== null ? ((input.headingDeg + offset) % 360 + 360) % 360 : null;
  const sector = bearingDeg !== null ? sectorCenterDeg(bearingDeg) : null;
  const nearBoundary = bearingDeg !== null ? boundaryDistanceDeg(bearingDeg) <= (opts.nowBoundary ?? BOUNDARY_WARN_DEG) : false;

  let status: LabelStatus;
  if (headingOk && input.confirmed && input.homeAtCenter && input.quality === "valid" && !nearBoundary) {
    status = "confirmed-home";
  } else if (nearBoundary || !headingOk || !input.confirmed) {
    // 交界、方位退化、未確認物件：一律中性待確認，不給確定吉凶（規格 7／決策 9）
    status = "pending";
  } else {
    status = "heading-ref";
  }

  const star = status !== "pending" && sector !== null && wheel ? wheel[sector] : null;
  const p = sector !== null ? PALACES.find((x) => x.deg === sector) ?? null : null;

  return {
    status,
    bearingDeg: status !== "pending" ? bearingDeg : null,
    sector,
    palace: p?.name ?? null,
    palaceBranch: p?.branch ?? null,
    star,
    isGood: star !== null ? isGoodStar(star) : null,
    nearBoundary,
    angularOffsetDeg: offset,
  };
}

/** 狀態短語（決策 25A：自動區分朝向參考／住宅宮位已確認／待確認） */
export function statusText(status: LabelStatus): string {
  switch (status) {
    case "confirmed-home":
      return "住宅宮位已確認";
    case "heading-ref":
      return "朝向參考";
    case "pending":
      return "待確認";
  }
}
