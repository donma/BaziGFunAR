/**
 * 校正彈窗（繼承原版）：以已知方位設定人工偏移（套在濾波之後、立即生效）。
 * 偏移只存在本次執行，不跨次保存（原版規則：偏移依裝置與磁場而異）。
 */
import { CenterModal } from "./ui";

export interface CalibrationModalProps {
  open: boolean;
  onClose: () => void;
  /** 讓目前顯示值等於 targetDeg；回傳是否成功（無即時資料時失敗） */
  calibrateTo: (targetDeg: number) => boolean;
  /** 目前偏移（顯示用） */
  manualOffsetDeg: number;
  /** 鏡頭近垂直時校正不可靠 */
  tiltDegraded: boolean;
  onReset: () => void;
  showToast: (msg: string) => void;
  isManual?: boolean;
}

export function signedOffset(deg: number): string {
  const d = ((deg + 540) % 360) - 180;
  const r = Math.round(d);
  return `${r > 0 ? "+" : ""}${r}°`;
}

export function CalibrationModal(p: CalibrationModalProps) {
  const doCalibrate = (targetDeg: number, label: string) => {
    p.onClose();
    if (p.isManual) {
      p.showToast("手動方位不需要校正；返回感測後再校正");
      return;
    }
    if (p.tiltDegraded) {
      p.showToast("鏡頭接近朝天／地，請水平對準後再校正");
      return;
    }
    if (p.calibrateTo(targetDeg)) p.showToast(`已校正：目前朝向視為${label}（${targetDeg}°）`);
    else p.showToast("尚無即時感測資料，無法校正");
  };

  return (
    <CenterModal open={p.open} onClose={p.onClose} title="校正指南針">
      <p className="modal-text">
        將鏡頭水平對準已知方位後，按下對應按鈕，系統會設定角度偏移（目前偏移{" "}
        <b>{signedOffset(p.manualOffsetDeg)}</b>）。這只補償顯示基準，不保證完成硬體磁力計校正；金屬與電器旁的磁場也會影響方位。
      </p>
      <div className="cal-grid">
        {(
          [
            [0, "北"],
            [90, "東"],
            [180, "南"],
            [270, "西"],
          ] as Array<[number, string]>
        ).map(([deg, label]) => (
          <button key={deg} className="btn" onClick={() => doCalibrate(deg, label)}>
            對準{label}
          </button>
        ))}
      </div>
      <button
        className="btn"
        style={{ width: "100%", marginTop: 10 }}
        onClick={() => {
          p.onReset();
          p.onClose();
          p.showToast("偏移已重置");
        }}
      >
        重置偏移
      </button>
    </CenterModal>
  );
}
