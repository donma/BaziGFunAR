/**
 * AR 覆蓋層渲染器（規格 8／決策 3B、13A、15C）：
 * - 物件光框：貼合偵測框的圓角框＋柔光；吉＝柔綠、凶＝柔紅、待確認＝淡金。
 * - 立體貼紙：靜態玻璃卡（無持續動畫、無粒子），僅允許平滑位置更新與淡入淡出。
 * - 純 DOM/CSS（決策 22B：CSS 3D 足以呈現靜態立體貼紙，較 WebGL 更省電且文字清晰）。
 * - 每幀以 transform 直接更新（不走 React re-render），觸控區 ≥44px。
 * - 卡片可拖曳修正位置（決策 8），拖曳與點擊以移動閾值區分。
 */

import type { Track } from "../tracking/tracker";
import type { StickerPlan } from "./stickerLayout";
import { STICKER_BASE_H } from "./stickerLayout";

export type StickerTone = "good" | "bad" | "pending";

export interface StickerView {
  id: number;
  tone: StickerTone;
  /** 卡片主字：星名或「幾何候選」 */
  title: string;
  /** 副行：一句說明（幾何候選為確認提示） */
  sub: string;
  /** 狀態短語：朝向參考／住宅宮位已確認／待確認 */
  status: string;
  /** 含使用者偏移的框（正規化座標） */
  box: { x: number; y: number; w: number; h: number };
  /** 使用者拖曳偏移（CSS px） */
  userOffX: number;
  userOffY: number;
  showCard: boolean;
  scale: number;
  fading: boolean;
  /** 幾何候選未確認（顯示確認提示與虛線框） */
  needsConfirm: boolean;
}

export interface StickerRendererCallbacks {
  onTap: (trackId: number) => void;
  onDrag: (trackId: number, dxNorm: number, dyNorm: number) => void;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

export class StickerRenderer {
  private layer: HTMLElement;
  private items = new Map<
    number,
    { frame: HTMLDivElement; card: HTMLButtonElement | null; last: StickerView }
  >();
  private cb: StickerRendererCallbacks;
  private disposed = false;

  constructor(container: HTMLElement, cb: StickerRendererCallbacks) {
    this.cb = cb;
    this.layer = document.createElement("div");
    this.layer.className = "ar-layer";
    container.appendChild(this.layer);
  }

  dispose(): void {
    this.disposed = true;
    this.layer.remove();
    this.items.clear();
  }

  /** 全量同步（每個辨識 tick 呼叫一次）；位置細部更新用 tickViews */
  sync(views: StickerView[], plans: Map<number, StickerPlan>): void {
    if (this.disposed) return;
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      const plan = plans.get(v.id);
      const showCard = plan ? plan.showCard : v.showCard;
      const scale = plan ? plan.scale : v.scale;
      let item = this.items.get(v.id);
      if (!item) {
        item = this.create(v, showCard);
        this.items.set(v.id, item);
        requestAnimationFrame(() => {
          item?.frame.classList.add("is-in");
          item?.card?.classList.add("is-in");
        });
      } else {
        this.apply(item, v, showCard, scale);
      }
    }
    for (const [id, item] of [...this.items]) {
      if (!seen.has(id)) {
        this.items.delete(id);
        item.frame.classList.remove("is-in");
        item.card?.classList.remove("is-in");
        window.setTimeout(() => {
          item.frame.remove();
          item.card?.remove();
        }, 320);
      }
    }
  }

  /** 每幀位置更新（rAF）：平滑跟隨，不重建 DOM */
  tickViews(views: StickerView[], plans: Map<number, StickerPlan>): void {
    if (this.disposed) return;
    for (const v of views) {
      const item = this.items.get(v.id);
      if (!item) continue;
      const plan = plans.get(v.id);
      this.apply(item, v, plan ? plan.showCard : v.showCard, plan ? plan.scale : v.scale);
    }
  }

  private create(v: StickerView, showCard: boolean): { frame: HTMLDivElement; card: HTMLButtonElement | null; last: StickerView } {
    const frame = document.createElement("div");
    frame.className = `ar-frame tone-${v.tone}${v.needsConfirm ? " is-geo" : ""}`;
    this.layer.appendChild(frame);

    let card: HTMLButtonElement | null = null;
    if (showCard || v.needsConfirm) {
      card = document.createElement("button");
      card.type = "button";
      card.className = `ar-sticker tone-${v.tone}${v.needsConfirm ? " is-geo" : ""}`;
      this.fillCard(card, v);
      this.attachPointer(card, v.id);
      this.layer.appendChild(card);
    }
    const item = { frame, card, last: v };
    this.apply(item, v, showCard, v.scale);
    return item;
  }

  private fillCard(card: HTMLButtonElement, v: StickerView): void {
    card.innerHTML = `
      <span class="ar-sticker-title">${escapeHtml(v.title)}</span>
      <span class="ar-sticker-sub">${escapeHtml(v.sub)}</span>
      <span class="ar-sticker-status">${escapeHtml(v.status)}</span>
    `;
    card.setAttribute("aria-label", `${v.title}，${v.sub}，${v.status}，點擊查看詳情`);
  }

  private apply(
    item: { frame: HTMLDivElement; card: HTMLButtonElement | null; last: StickerView },
    v: StickerView,
    showCard: boolean,
    scale: number,
  ): void {
    // tone／needsConfirm 變更時重建 class 與內容
    if (item.last.tone !== v.tone || item.last.needsConfirm !== v.needsConfirm) {
      const inCls = item.frame.classList.contains("is-in") ? " is-in" : "";
      item.frame.className = `ar-frame tone-${v.tone}${v.needsConfirm ? " is-geo" : ""}${inCls}`;
      if (item.card) {
        const cIn = item.card.classList.contains("is-in") ? " is-in" : "";
        item.card.className = `ar-sticker tone-${v.tone}${v.needsConfirm ? " is-geo" : ""}${cIn}`;
        this.fillCard(item.card, v);
      }
    }
    item.last = v;

    const b = v.box;
    item.frame.style.transform = `translate(${pct(b.x)}, ${pct(b.y)})`;
    item.frame.style.width = pct(b.w);
    item.frame.style.height = pct(b.h);
    item.frame.classList.toggle("is-fading", v.fading);

    if (item.card) {
      const s = clamp(scale, 0.8, 1.35);
      const h = Math.max(44, STICKER_BASE_H * s);
      const cardW = Math.max(150, Math.min(232, b.w * this.layer.clientWidth * 1.35));
      const cx = b.x * this.layer.clientWidth + b.w * this.layer.clientWidth / 2;
      const cy = b.y * this.layer.clientHeight;
      const px = clamp(cx + v.userOffX, cardW / 2 + 6, this.layer.clientWidth - cardW / 2 - 6);
      const py = clamp(cy + v.userOffY - h * 0.62, h / 2 + 4, this.layer.clientHeight - h / 2 - 4);
      item.card.style.setProperty("--card-w", `${cardW}px`);
      item.card.style.setProperty("--card-h", `${h}px`);
      item.card.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px)`;
      item.card.classList.toggle("is-fading", v.fading);
      const visible = showCard || v.needsConfirm;
      item.card.classList.toggle("is-hidden", !visible);
      item.card.disabled = v.fading;
    }
  }

  private attachPointer(card: HTMLButtonElement, id: number): void {
    card.addEventListener("pointerdown", (e) => {
      const drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, pointerId: e.pointerId };
      card.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (drag.pointerId !== ev.pointerId) return;
        const dx = ev.clientX - drag.lastX;
        const dy = ev.clientY - drag.lastY;
        drag.lastX = ev.clientX;
        drag.lastY = ev.clientY;
        if (Math.abs(ev.clientX - drag.startX) > 7 || Math.abs(ev.clientY - drag.startY) > 7) {
          drag.moved = true;
          this.cb.onDrag(id, dx / Math.max(1, this.layer.clientWidth), dy / Math.max(1, this.layer.clientHeight));
        }
      };
      const up = (ev: PointerEvent) => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerup", up);
        card.removeEventListener("pointercancel", up);
        if (drag.pointerId === ev.pointerId && !drag.moved) this.cb.onTap(id);
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerup", up);
      card.addEventListener("pointercancel", up);
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
