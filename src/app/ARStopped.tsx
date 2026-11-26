/**
 * AR 停止畫面（決策 20A）：必要相機／方向感測權限不足或能力不可用時停止 AR，
 * 顯示簡潔原因與重新授權入口；非 AR 功能保留可用。
 * 與「本機 AI 模型尚未下載」不同：模型暫不可用但必要權限具備時，仍可顯示相機與方向。
 */
import type { SheetKind } from "./types";

export interface ARStopReasons {
  sensor?: "denied" | "unsupported";
  camera?: "denied" | "failed" | "missing" | "ended" | "occupied";
}

const SENSOR_TEXT: Record<string, { title: string; desc: string }> = {
  denied: {
    title: "方向感測權限被拒絕",
    desc: "沒有方向資料就無法標示可信的八方吉凶。請允許「動作與方向」感測器後重試；iOS 也可到 設定 → Safari → 動作與方向存取 允許後重新載入。",
  },
  unsupported: {
    title: "此裝置不支援方向感測",
    desc: "此瀏覽器沒有提供方向感測資料，無法進行實景 AR。你可以使用手動方位工具查看八方吉凶。",
  },
};

const CAMERA_TEXT: Record<string, { title: string; desc: string }> = {
  denied: {
    title: "相機權限被拒絕",
    desc: "實景 AR 需要後置相機。請在瀏覽器網址列的權限設定中允許相機後重試。",
  },
  failed: {
    title: "相機無法啟動",
    desc: "請確認使用 HTTPS（或 localhost）並關閉其他正在使用相機的 App／分頁後重試。",
  },
  missing: {
    title: "找不到可用相機",
    desc: "此裝置可能沒有後置鏡頭，無法進行實景 AR。",
  },
  ended: {
    title: "相機畫面已中斷",
    desc: "相機可能被其他 App 使用。點「重新開啟相機」即可恢復。",
  },
  occupied: {
    title: "相機被其他應用佔用",
    desc: "關閉其他使用相機的 App／分頁後，點「重新開啟相機」。",
  },
};

export function ARStopped({
  reasons,
  onRetryCamera,
  onRetrySensor,
  openSheet,
  retrying,
}: {
  reasons: ARStopReasons;
  onRetryCamera: () => void;
  onRetrySensor: () => Promise<void>;
  openSheet: (kind: SheetKind) => void;
  retrying: boolean;
}) {
  const sensor = reasons.sensor ? SENSOR_TEXT[reasons.sensor] : null;
  const camera = reasons.camera ? CAMERA_TEXT[reasons.camera] : null;

  return (
    <div className="ar-stopped">
      <div className="ar-stopped-icon" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 2l20 20" />
          <path d="M9 5a7 7 0 0 1 10 6.5c0 1.6-.5 3-1.4 4.2" />
          <path d="M6.2 6.2A7 7 0 0 0 5 11.5c0 3 2 5.5 5 6.4v1.6a1 1 0 0 0 1 1h2" />
          <circle cx="12" cy="11.5" r="2.2" />
        </svg>
      </div>
      <h1>實景 AR 已暫停</h1>
      <p className="ar-stopped-lead">為了不顯示不可靠的方位吉凶，缺少必要權限時 AR 會停止。以下功能仍可使用。</p>

      {sensor && (
        <div className="ar-stop-card">
          <div className="ar-stop-title">{sensor.title}</div>
          <p>{sensor.desc}</p>
          {reasons.sensor === "denied" && (
            <button className="btn primary" onClick={() => void onRetrySensor()} disabled={retrying}>
              {retrying ? "處理中…" : "啟用方向感測"}
            </button>
          )}
        </div>
      )}
      {camera && (
        <div className="ar-stop-card">
          <div className="ar-stop-title">{camera.title}</div>
          <p>{camera.desc}</p>
          <button className="btn primary" onClick={onRetryCamera} disabled={retrying}>
            {retrying ? "處理中…" : reasons.camera === "ended" ? "重新開啟相機" : "重試相機"}
          </button>
        </div>
      )}

      <div className="ar-stop-actions">
        <button className="btn" onClick={() => openSheet("persons")}>人物</button>
        <button className="btn" onClick={() => openSheet("records")}>紀錄</button>
        <button className="btn" onClick={() => openSheet("analysis")}>命卦方位</button>
        <button className="btn" onClick={() => openSheet("manual")}>手動方位工具</button>
        <button className="btn" onClick={() => openSheet("settings")}>設定</button>
      </div>
      <p className="hint ar-stopped-note">AR 需要相機與方向感測同時可用；兩者都就緒時會自動恢復。</p>
    </div>
  );
}
