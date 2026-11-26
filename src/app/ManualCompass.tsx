/**
 * 手動方位工具（原版手動羅盤業務功能的非 AR 延續，決策 20A）：
 * AR 因權限不足停止時仍可查看八方吉凶、校正偏移、手動對準、鎖定方位與交界提醒。
 * 無相機、無物件貼紙，不宣稱住宅宮位。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { KUA_TABLE, kuaTitle, type KuaInfo, type MingGuaResult } from "../domain/bazhai/mingGua";
import { BOUNDARY_WARN_DEG, PALACES, STARS, isGoodStar, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { boundaryDistanceDeg, normalizeDeg } from "../domain/compass/heading";
import { useHeading } from "../sensors/useHeading";
import { useStableSector } from "../sensors/useStableSector";
import { CalibrationModal, signedOffset } from "./CalibrationModal";
import { STAR_DESC } from "./starText";
import type { AppSettings, Person } from "../storage/storage";

interface Reading {
  heading: number;
  raw: number | null;
  source: "sensor" | "manual";
  quality: "valid" | "uncertain" | "unavailable";
}

export function ManualCompass({
  person,
  mingGua,
  wheel,
  settings,
  updateSettings,
  onClose,
  showToast,
}: {
  person: Person | null;
  mingGua: MingGuaResult | null;
  wheel: Record<DirectionDeg, StarKey> | null;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  const [manualMode, setManualMode] = useState(false);
  const [manualDeg, setManualDeg] = useState(0);
  const [locked, setLocked] = useState<Reading | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const lastGood = useRef<number | null>(null);

  const heading = useHeading(!manualMode, settings.northReference);
  const hs = heading.state;
  const declination = settings.northReference === "true" ? settings.declinationDeg : 0;
  const adjusted = hs.displayHeading !== null ? normalizeDeg(hs.displayHeading + declination) : null;
  const sensorLive = adjusted !== null && hs.quality !== "unavailable";
  const live: Reading | null = manualMode
    ? { heading: manualDeg, raw: null, source: "manual", quality: "valid" }
    : sensorLive
      ? { heading: adjusted!, raw: hs.rawHeading, source: "sensor", quality: hs.quality }
      : null;
  const reading = locked ?? live;
  const degraded = !manualMode && hs.tiltDegraded;
  if (reading && !degraded) lastGood.current = reading.heading;
  const viewHeading = degraded && lastGood.current !== null ? lastGood.current : reading?.heading ?? null;
  const sector = useStableSector(viewHeading, degraded || !reading);
  const star = sector !== null && wheel ? wheel[sector] : null;
  const palace = sector !== null ? PALACES.find((x) => x.deg === sector) ?? null : null;
  const bd = viewHeading !== null ? boundaryDistanceDeg(viewHeading) : null;
  const nearBoundary = !!reading && !degraded && bd !== null && bd <= BOUNDARY_WARN_DEG;
  const offsetActive = Math.abs(((heading.manualOffsetDeg + 540) % 360) - 180) >= 0.5;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleManual = () => {
    setLocked(null);
    if (!manualMode) setManualDeg(Math.round(viewHeading ?? 0));
    setManualMode(!manualMode);
  };

  const openCalibration = async () => {
    if (manualMode) {
      showToast("手動模式不需要校正");
      return;
    }
    setCalOpen(true);
  };

  const kuaInfo: KuaInfo | null = mingGua ? KUA_TABLE[mingGua.kua] : null;

  return (
    <div className="manual-screen">
      <header className="manual-head">
        <button className="icon-btn" onClick={onClose} aria-label="返回 AR">‹</button>
        <div>
          <h1>手動方位工具</h1>
          <p>{person ? `${person.name}｜${mingGua ? kuaTitle(mingGua.kua) : "—"}` : "請先建立人物"}</p>
        </div>
        <span className="chip">非 AR</span>
      </header>

      <div className="manual-body">
        <div className="manual-card">
          <div className="manual-deg">{viewHeading !== null ? `${Math.round(normalizeDeg(viewHeading)) % 360}°` : "—"}</div>
          <div className="manual-dir">{palace?.shortName ?? "—"} {palace?.branch ?? "—"}方</div>
          {star && (
            <div className={`manual-star ${isGoodStar(star) ? "good" : "bad"} ${reading && !degraded ? "" : "is-dim"}`}>
              {STARS[star].name}（{isGoodStar(star) ? "吉方" : "凶方"}）
            </div>
          )}
          {degraded && <p className="hint">鏡頭接近朝天／地，方位已凍結；拿正手機即可恢復。</p>}
          {nearBoundary && <p className="warn-line">接近方位交界（距邊界 {bd!.toFixed(1)}°），吉凶可能跳動。</p>}
          {star && <p className="manual-desc">{STAR_DESC[star]}</p>}
        </div>

        {manualMode && (
          <div className="manual-bar">
            <button className="nudge" onClick={() => setManualDeg((d) => normalizeDeg(d - 1))}>−1°</button>
            <input type="range" min={0} max={359} value={Math.round(manualDeg) % 360} onChange={(e) => setManualDeg(Number(e.target.value))} aria-label="手動調整方位" />
            <button className="nudge" onClick={() => setManualDeg((d) => normalizeDeg(d + 1))}>+1°</button>
          </div>
        )}

        <div className="status-chips manual-chips">
          <span className={`chip ${manualMode ? "" : hs.quality === "valid" ? "good" : "warn"}`}>
            {manualMode ? "手動" : hs.semantic === "relative-euler" ? "需校正" : hs.quality === "valid" ? "感測✓" : "無感測"}
          </span>
          {locked && <span className="chip warn">已鎖定</span>}
          {offsetActive && <span className="chip warn">偏移 {signedOffset(heading.manualOffsetDeg)}</span>}
        </div>

        <div className="btn-row manual-actions">
          <button className="btn" onClick={() => void openCalibration()}>校正指南針</button>
          <button className="btn" onClick={toggleManual}>{manualMode ? "返回感測" : "切換手動"}</button>
          <button
            className="btn"
            disabled={!reading}
            onClick={() => {
              if (locked) setLocked(null);
              else if (reading) setLocked(reading);
            }}
          >
            {locked ? "解鎖方位" : "鎖定方位"}
          </button>
        </div>

        <p className="hint manual-note">
          此工具為非 AR 備援，只顯示鏡頭／手動朝向的八宅参考，不代表任何物件已確認位於住宅宮位。
          {kuaInfo?.group === "east4" ? "東四命" : kuaInfo ? "西四命" : ""}・{signature(settings)}
        </p>
      </div>

      <CalibrationModal
        open={calOpen}
        onClose={() => setCalOpen(false)}
        calibrateTo={heading.calibrateTo}
        manualOffsetDeg={heading.manualOffsetDeg}
        tiltDegraded={hs.tiltDegraded}
        onReset={() => {
          heading.setManualOffsetDeg(0);
          updateSettings({ manualOffsetDeg: 0 });
        }}
        showToast={showToast}
        isManual={manualMode}
      />
    </div>
  );
}

function signature(s: AppSettings): string {
  return s.northReference === "true" ? `真北（磁偏角 ${signedOffset(s.declinationDeg)}）` : "磁北";
}
