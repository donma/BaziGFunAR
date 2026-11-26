/**
 * 設定：北向基準、住宅定位（決策 24B 選用）、校正入口、手動方位工具、匯出與版本。
 * 真北採「使用者提供磁偏角」方式，套用現成 applyDeclination 規則；不內建未查證的磁偏角資料，也不默默冒充。
 */
import { useEffect, useState } from "react";
import { estimateStorage, listRecords, type AppSettings } from "../../storage/storage";
import { buildExportJSON, exportZip, shareOrDownload } from "../../export/exporter";
import { APP_VERSION } from "../version";
import { BottomSheet } from "../ui";
import type { SheetKind } from "../types";

export function SettingsSheet(p: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  openSheet: (kind: SheetKind) => void;
  showToast: (msg: string) => void;
}) {
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    if (!p.open) return;
    void estimateStorage().then(setStorage);
  }, [p.open]);

  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="設定" subtitle="本機離線・無帳號・不上傳資料">
      <div className="set-section">
        <h3>北向基準</h3>
        <div className="segmented">
          <button
            className={p.settings.northReference === "magnetic" ? "on" : ""}
            onClick={() => p.updateSettings({ northReference: "magnetic" })}
          >
            磁北（預設）
          </button>
          <button
            className={p.settings.northReference === "true" ? "on" : ""}
            onClick={() => p.updateSettings({ northReference: "true" })}
          >
            真北（需磁偏角）
          </button>
        </div>
        {p.settings.northReference === "true" && (
          <div className="field">
            <label>當地磁偏角（度；東偏為正，西偏為負）</label>
            <input
              type="number"
              min={-90}
              max={90}
              step={0.1}
              value={p.settings.declinationDeg}
              onChange={(e) => p.updateSettings({ declinationDeg: Number(e.target.value) || 0 })}
            />
            <p className="hint">請自行查證所在地當前的磁偏角；這個值只補償顯示基準，Apps 不會自動取得定位。</p>
          </div>
        )}
        {p.settings.northReference === "magnetic" && (
          <p className="hint">磁北為預設基準。手機磁力計仍可能受金屬與電器干擾，校正請用 AR 畫面的「校正」按鈕。</p>
        )}
      </div>

      <div className="set-section">
        <h3>住宅宮位定位（選用）</h3>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={p.settings.homeAtCenter}
            onChange={(e) =>
              p.updateSettings({ homeAtCenter: e.target.checked, homeSetAt: e.target.checked ? new Date().toISOString() : null })
            }
          />
          <span>
            <b>我目前站在住宅中心附近</b>
            <small>只有在你確認此點、且感測良好、遠離方位交界時，標籤才會顯示「住宅宮位已確認」。</small>
          </span>
        </label>
        <p className="hint">預設不開啟：一般模式只給朝向參考。純 PWA 無法保證原生等級的空間錨定，系統不會用 2D 框冒充住宅幾何位置。</p>
      </div>

      <div className="set-section">
        <h3>方位工具</h3>
        <button className="btn wide" onClick={() => p.openSheet("manual")}>手動方位工具（含校正與交界提醒）</button>
      </div>

      <div className="set-section">
        <h3>資料</h3>
        <div className="btn-row">
          <button
            className="btn"
            onClick={async () => {
              try {
                await shareOrDownload("bazigfun-ar-data.json", buildExportJSON(await listRecords()));
                p.showToast("JSON 已匯出");
              } catch (e) { p.showToast(`匯出失敗：${(e as Error).message}`); }
            }}
          >
            匯出 JSON
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                const res = await exportZip();
                await shareOrDownload(res.filename, res.blob);
                p.showToast("ZIP 已匯出");
              } catch (e) { p.showToast(`匯出失敗：${(e as Error).message}`); }
            }}
          >
            匯出 ZIP
          </button>
        </div>
        <p className="hint">不提供舊版人物匯入（決策 29A）。清除網站資料可能導致紀錄消失，請定期匯出。</p>
        {storage && (
          <p className="hint">本機用量：{(storage.usage / 1024 / 1024).toFixed(1)} MB / 配额 {(storage.quota / 1024 / 1024).toFixed(0)} MB</p>
        )}
      </div>

      <div className="set-section">
        <h3>關於</h3>
        <p className="hint">BaziGFun AR v{APP_VERSION}。八宅風水為傳統文化參考，不宣稱科學驗證的因果事實。相機影格、出生資料與照片不離開裝置。</p>
      </div>
    </BottomSheet>
  );
}
