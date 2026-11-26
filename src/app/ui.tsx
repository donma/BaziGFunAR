/**
 * 底部資訊卡容器（規格 9／決策 5B、16B）：
 * - 預設約螢幕 35%（依安全區域自動調整）；上滑全展開、下滑收合（收合即關閉）。
 * - 同時只能有一張（由上層保證）；手機返回操作先關閉卡片（由上層 history 處理）。
 * - iOS safe area 以 env() 處理。
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export const SHEET_COLLAPSED_VH = 35;
export const SHEET_EXPANDED_VH = 92;

export function BottomSheet({ open, onClose, title, subtitle, children }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ startY: number; startExpanded: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startExpanded: expanded };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [expanded]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (dy < -36 && !d.startExpanded) setExpanded(true);
    if (dy > 36 && d.startExpanded) setExpanded(false);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.startExpanded && dy > 60) onClose(); // 收合狀態再下滑 → 關閉
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className={`sheet ${expanded ? "is-expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "資訊卡"}
      >
        <div
          className="sheet-grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="sheet-handle" />
          <div className="sheet-head">
            {title && <h2 className="sheet-title">{title}</h2>}
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** 置中彈窗（照片詳情、校正） */
export function CenterModal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal glass ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
