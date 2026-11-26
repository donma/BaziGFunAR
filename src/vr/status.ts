/**
 * 偽 VR 盤面的可信度狀態（誠實標示，取代舊版物件貼紙的三種標籤）。
 *
 * 盤面是「以你所站位置為圓心」的方位盤，依手機方位換算；它不偵測任何物件，也不是整戶住宅的
 * 幾何定位。只有使用者確認「我站在住宅中心」且感測良好時，才標為住宅中心方位。
 */
import type { Quality } from "../domain/compass/heading";
import type { DetectionState } from "../storage/storage";

export type FloorStatus = "home-center" | "heading-ref" | "pending";

export function floorStatus(input: { trusted: boolean; quality: Quality; homeAtCenter: boolean }): FloorStatus {
  if (!input.trusted) return "pending";
  if (input.homeAtCenter && input.quality === "valid") return "home-center";
  return "heading-ref";
}

export function floorStatusText(s: FloorStatus): string {
  switch (s) {
    case "home-center":
      return "住宅中心方位";
    case "heading-ref":
      return "目前位置方位（朝向參考）";
    case "pending":
      return "方位待校正";
  }
}

/** 拍照紀錄用的定位狀態（沿用 schema v2 欄位） */
export function detectionStateOf(s: FloorStatus, hasSensor: boolean): DetectionState {
  if (s === "home-center") return "confirmed-home";
  if (s === "heading-ref") return "heading-ref";
  return hasSensor ? "pending" : "none";
}
