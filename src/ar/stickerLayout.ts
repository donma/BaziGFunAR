/**
 * Sticker 選擇與版面（規格 8／決策 11B／15C）：
 * - 畫面同時約 2–4 個重要標籤；同吉凶區域去重；互相重疊時保留優先者、次者降為僅光框。
 * - 標籤尺寸自適應（物件大小＋畫面比例），觸控區 ≥44 CSS px。
 */

import { defOf, type ObjectKind } from "../vision/labels";
import type { Track } from "../tracking/tracker";
import type { SpatialResult } from "./spatial";

export interface StickerInput {
  track: Track;
  spatial: SpatialResult;
  /** 正規化框面積（0–1） */
  areaFrac: number;
}

export interface StickerPlan {
  trackId: number;
  /** 顯示卡片（false＝僅光框） */
  showCard: boolean;
  /** 自適應高度係數（1＝基準） */
  scale: number;
}

export const STICKER_BASE_H = 64; // CSS px 基準卡高（≥44）
export const MIN_TAP_PX = 44;

/** 畫面同時顯示的卡片上限（規格 8：約 2–4） */
export const MAX_CARDS = 4;

/** 選擇要顯示卡片的 sticker：優先權＝類別權重×分數×面積（限制上限） */
export function selectCards(inputs: StickerInput[], maxCards = MAX_CARDS): Set<number> {
  const scored = inputs
    .map((i) => ({
      trackId: i.track.id,
      score:
        defOf(i.track.kind as ObjectKind).priority * (0.5 + i.track.score * 0.5) * (0.6 + i.areaFrac * 4),
    }))
    .sort((a, b) => b.score - a.score);
  const chosen = new Set<number>();
  for (const s of scored) {
    if (chosen.size >= maxCards) break;
    chosen.add(s.trackId);
  }
  return chosen;
}

/** 同吉凶同扇區去重：保留第一個（呼叫端已依優先度排序），其餘降為僅光框 */
export function dedupeSameSector(inputs: StickerInput[], chosen: Set<number>): Set<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  for (const i of inputs) {
    if (!chosen.has(i.track.id)) continue;
    const s = i.spatial;
    if (s.status === "pending") {
      out.add(i.track.id);
      continue;
    }
    const key = `${s.sector}|${s.star ?? ""}|${s.status}`;
    if (seen.has(key)) continue; // 同區域重複 → 降為僅光框（不加入 out）
    seen.add(key);
    out.add(i.track.id);
  }
  return out;
}

/** 卡片矩形（正規化座標，含卡高換算）用於重疊判斷 */
export function cardRect(input: StickerInput, viewH: number): { x: number; y: number; w: number; h: number } {
  const b = input.track.box;
  const cardH = cardHeightPx(input, viewH) / viewH;
  const cardW = Math.max(0.16, Math.min(0.42, b.w * 1.4));
  const cx = b.x + b.w / 2;
  const x = Math.max(0.01, Math.min(0.99 - cardW, cx - cardW / 2)) + input.track.userOffset.dx;
  const y = Math.max(0.01, b.y - cardH - 0.01) + input.track.userOffset.dy;
  return { x, y, w: cardW, h: cardH };
}

export function cardHeightPx(input: StickerInput, viewH: number): number {
  // 自適應：物件越大（近）卡越高，上下限 44–88px
  const base = STICKER_BASE_H * Math.max(0.8, Math.min(1.35, input.track.box.h * 2.4));
  return Math.max(MIN_TAP_PX, Math.min(88, base));
}

/** 兩卡片矩形重疊面積比（相對較小者） */
function overlapRatio(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  return inter / Math.min(areaA, areaB);
}

/**
 * 產生最終版面計畫：
 * 1) 選卡片（上限） 2) 同扇區去重 3) 重疊避讓（降為僅光框）。
 */
export function planLayout(inputs: StickerInput[], viewW: number, viewH: number, maxCards = MAX_CARDS): StickerPlan[] {
  const ordered = [...inputs].sort((a, b) => {
    const pa = defOf(a.track.kind as ObjectKind).priority * (0.5 + a.track.score * 0.5);
    const pb = defOf(b.track.kind as ObjectKind).priority * (0.5 + b.track.score * 0.5);
    return pb - pa;
  });
  const picked = dedupeSameSector(ordered, selectCards(ordered, maxCards));

  const rects = new Map<number, { x: number; y: number; w: number; h: number }>();
  const plans: StickerPlan[] = [];
  for (const i of ordered) {
    const withCard = picked.has(i.track.id);
    const rect = withCard ? cardRect(i, viewH) : null;
    if (withCard && rect) {
      const clash = [...rects.values()].find((r) => overlapRatio(r, rect) > 0.45);
      if (clash) {
        // 重疊避讓：此卡片降為僅光框（規格 8：自動避讓、合併或隱藏次要標籤）
        plans.push({ trackId: i.track.id, showCard: false, scale: 1 });
        continue;
      }
      rects.set(i.track.id, rect);
      plans.push({ trackId: i.track.id, showCard: true, scale: rect.h * viewH / STICKER_BASE_H });
    } else {
      plans.push({ trackId: i.track.id, showCard: false, scale: 1 });
    }
  }
  void viewW;
  return plans;
}
