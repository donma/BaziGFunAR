/**
 * AR 主畫面（偽 VR）：你站在八宅羅盤中央。
 * 頂部人物／方位、中央全螢幕實景＋腳下發光八宅盤、底部人物／快門／設定。
 * 平常沒有任何卡片；點擊某個扇區才從底部滑出該方位的解讀。
 *
 * 資料誠實性：
 * - 相機＋方向感測為 AR 的必要條件（決策 20A），缺任一即顯示停止畫面，非 AR 功能保留。
 * - 盤面以你所站位置為圓心，依手機方位換算；不偵測物件，不宣稱住宅幾何定位。
 * - 鏡頭朝天／地時凍結方位（移植原版規則）；方位不可信時整體降亮度並提示校正。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { KUA_TABLE, kuaTitle, type KuaInfo, type MingGuaResult } from "../domain/bazhai/mingGua";
import { BOUNDARY_WARN_DEG, PALACES, STARS, isGoodStar, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { boundaryDistanceDeg, normalizeDeg } from "../domain/compass/heading";
import { useHeading } from "../sensors/useHeading";
import { useStableSector } from "../sensors/useStableSector";
import { requestOrientationPermission, type SensorPermission } from "../sensors/deviceOrientation";
import { VRScene } from "../vr/scene";
import { detectionStateOf, floorStatus, floorStatusText } from "../vr/status";
import { capturePair } from "../capture/capture";
import { makeCaptureRecord } from "../capture/record";
import { putPhoto, putRecord, uuid, type AppSettings, type Person } from "../storage/storage";
import { STAR_DESC, STAR_LAYOUT, STAR_SHORT } from "./starText";
import { BottomSheet } from "./ui";
import { CalibrationModal, signedOffset } from "./CalibrationModal";
import { ARStopped, type ARStopReasons } from "./ARStopped";
import type { SheetKind } from "./types";

export interface ARScreenProps {
  person: Person | null;
  mingGua: MingGuaResult | null;
  wheel: Record<DirectionDeg, StarKey> | null;
  kuaInfo: KuaInfo | null;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  openSheet: (kind: SheetKind) => void;
  appSheetOpen: boolean;
  initialSensorPermission: SensorPermission;
  requestSensor: () => Promise<void>;
  showToast: (msg: string) => void;
  onCaptureSaved: () => void;
}

type CameraBlock = NonNullable<ARStopReasons["camera"]>;

export function ARScreen(p: ARScreenProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<VRScene | null>(null);
  const [camState, setCamState] = useState<string>("idle");
  const [camBlock, setCamBlock] = useState<CameraBlock | null>(null);
  const [sector, setSector] = useState<DirectionDeg | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [capturePending, setCapturePending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const lastGoodHeading = useRef<number | null>(null);
  const appSheetOpenRef = useRef(p.appSheetOpen);
  appSheetOpenRef.current = p.appSheetOpen;

  const sensorBlocked = p.initialSensorPermission === "denied" || p.initialSensorPermission === "unsupported";
  const sensorDenied = p.initialSensorPermission === "denied";
  const stopped = sensorBlocked || camBlock !== null;

  /* ---------- 感測與方位（移植原版規則） ---------- */

  const heading = useHeading(!stopped && p.initialSensorPermission === "granted", p.settings.northReference);
  const hs = heading.state;
  const declination = p.settings.northReference === "true" ? p.settings.declinationDeg : 0;
  const adjustedHeading = hs.displayHeading !== null ? normalizeDeg(hs.displayHeading + declination) : null;

  const sensorLive = adjustedHeading !== null && hs.quality !== "unavailable";
  const trusted = sensorLive && !hs.tiltDegraded && hs.quality !== "uncertain";
  if (sensorLive && !hs.tiltDegraded && adjustedHeading !== null) lastGoodHeading.current = adjustedHeading;
  const viewHeading = hs.tiltDegraded && lastGoodHeading.current !== null ? lastGoodHeading.current : adjustedHeading;

  const stableSector = useStableSector(viewHeading, hs.tiltDegraded || !sensorLive);
  const star: StarKey | null = stableSector !== null && p.wheel ? p.wheel[stableSector] : null;
  const palace = stableSector !== null ? PALACES.find((x) => x.deg === stableSector) ?? null : null;
  const boundaryDist = viewHeading !== null ? boundaryDistanceDeg(viewHeading) : null;
  const nearBoundary = trusted && boundaryDist !== null && boundaryDist <= BOUNDARY_WARN_DEG;
  const offsetActive = Math.abs(((heading.manualOffsetDeg + 540) % 360) - 180) >= 0.5;
  const status = floorStatus({ trusted, quality: hs.quality, homeAtCenter: p.settings.homeAtCenter });

  /* ---------- 場景生命週期 ---------- */

  const handleCamError = useCallback(
    (err: unknown) => {
      const name = (err as DOMException)?.name ?? "failed";
      const block: CameraBlock =
        name === "NotAllowedError"
          ? "denied"
          : name === "NotFoundError"
            ? "missing"
            : name === "NotReadableError" || name === "AbortError"
              ? "occupied"
              : "failed";
      setCamBlock(block);
      p.showToast(`相機無法使用（${name}），AR 已暫停；其他功能仍可使用`);
    },
    [p.showToast],
  );

  const startCam = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      setCamState("starting");
      const ok = await scene.startCamera();
      setCamState(ok ? "running" : "idle");
      if (ok) setCamBlock(null);
    } catch (e) {
      setCamState("failed");
      handleCamError(e);
    }
  }, [handleCamError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || sensorBlocked) return;
    const scene = new VRScene(host, {
      onTapSector: (deg) => {
        if (!appSheetOpenRef.current) setSector(deg);
      },
    });
    scene.cam.onEnded = () => {
      setCamState("ended");
      p.showToast("相機畫面中斷（可能被其他 App 使用）。點狀態列的「相機中斷」重新開啟");
    };
    sceneRef.current = scene;
    scene.start();
    void startCam();
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // 只在感測可用性改變時重建場景
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorBlocked]);

  // 每次 render 把最新方位與設定送進場景（成本低）
  useEffect(() => {
    sceneRef.current?.setInput({
      heading: viewHeading,
      dim: !trusted,
      wheel: p.wheel,
      fovLongDeg: p.settings.fovLongDeg,
      selectedSector: sector,
    });
  });

  // 頁面進背景：關鏡頭＋暫停繪製；回前景：重開
  useEffect(() => {
    const onVis = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (document.hidden) {
        scene.pause();
        scene.stopCamera();
        setCamState("idle");
      } else if (!stopped) {
        void startCam();
        scene.start();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopped, startCam]);

  // 量測時保持螢幕不休眠
  useEffect(() => {
    if (stopped || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) void s.release();
        else sentinel = s;
      } catch {
        /* 不支援或被拒絕：略過 */
      }
    };
    void acquire();
    const onVis = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void sentinel?.release();
    };
  }, [stopped]);

  /* ---------- 扇區資訊卡（一次一張；返回鍵先關卡） ---------- */

  useEffect(() => {
    if (sector === null) return;
    history.pushState({ bazigfunar: "sector" }, "");
    const onPop = () => setSector(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sector]);

  useEffect(() => {
    if (p.appSheetOpen && sector !== null) setSector(null);
  }, [p.appSheetOpen, sector]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSector(null);
        setCalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeSector = useCallback(() => {
    setSector(null);
    if (history.state?.bazigfunar === "sector") history.back();
  }, []);

  /* ---------- 快門：一次產生原始＋AR 合成兩張照片 ---------- */

  const capture = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || capturePending) return;
    const frame = scene.captureFrame();
    if (!frame) {
      p.showToast("相機尚未就緒，無法拍照");
      return;
    }
    setCapturePending(true);
    try {
      const overlay = scene.captureState();
      const now = new Date();
      const good = star !== null && isGoodStar(star);
      const info = {
        headline:
          p.person && p.mingGua && p.kuaInfo
            ? `${p.person.name}｜${kuaTitle(p.mingGua.kua)}（${p.kuaInfo.group === "east4" ? "東四命" : "西四命"}）`
            : "BaziGFun AR｜實景記錄",
        main:
          star && palace && viewHeading !== null
            ? `${Math.round(viewHeading) % 360}° ${palace.branch}　${STARS[star].name}（${good ? "吉方" : "凶方"}）`
            : "方位未確認（無可信感測資料）",
        meta: `${now.toLocaleString()}｜${p.settings.northReference === "true" ? `真北（磁偏角 ${signedOffset(p.settings.declinationDeg)}）` : "磁北"}｜${hs.semantic ? "感測" : "無感測"}${hs.quality !== "valid" ? "｜可信度：弱" : ""}`,
        warn:
          nearBoundary && boundaryDist !== null
            ? `接近方位交界（距邊界 ${boundaryDist.toFixed(1)}°），吉凶可能跳動`
            : undefined,
        tone: (star ? (good ? "good" : "bad") : "none") as "good" | "bad" | "none",
      };

      const pair = await capturePair(frame, overlay, info);
      const rawId = uuid();
      const arId = uuid();
      try {
        await putPhoto(rawId, pair.raw, "image/jpeg", "raw");
        await putPhoto(arId, pair.ar, "image/jpeg", "ar");
      } catch (e) {
        p.showToast(
          (e as DOMException)?.name === "QuotaExceededError" ? "儲存空間不足，照片未能保存" : "照片儲存失敗",
        );
        return;
      }
      await putRecord(
        makeCaptureRecord({
          id: uuid(),
          rawId,
          arId,
          personId: p.person?.id ?? "",
          now,
          title: star && palace ? `${palace.branch}・${STARS[star].name}` : "實景照片",
          azimuthRaw: hs.rawHeading,
          azimuthDisplay: viewHeading !== null ? Math.round(viewHeading * 10) / 10 : null,
          source: hs.displayHeading !== null ? "sensor" : "none",
          northReference: p.settings.northReference,
          palace: palace?.name ?? "—",
          star: star ?? "",
          quality: hs.quality,
          nearBoundary,
          stickerCount: 0,
          detectionState: detectionStateOf(status, hs.displayHeading !== null),
        }),
      );
      p.onCaptureSaved();
      p.showToast("已拍照並記錄（原始實景＋AR 合成）");
    } catch (e) {
      p.showToast(`拍照失敗：${(e as Error).message}`);
    } finally {
      setCapturePending(false);
    }
  }, [capturePending, star, palace, viewHeading, nearBoundary, boundaryDist, hs, status, p]);

  /* ---------- 停止畫面（決策 20A） ---------- */

  if (stopped) {
    const reasons: ARStopReasons = {
      sensor: sensorDenied ? "denied" : p.initialSensorPermission === "unsupported" ? "unsupported" : undefined,
      camera: camBlock ?? undefined,
    };
    return (
      <div className="scene scene-stopped">
        <ARStopped
          reasons={reasons}
          retrying={retrying}
          onRetryCamera={() => {
            setCamBlock(null);
            void startCam();
          }}
          onRetrySensor={async () => {
            setRetrying(true);
            try {
              const res = await requestOrientationPermission();
              if (res === "granted") window.location.reload();
            } finally {
              setRetrying(false);
            }
          }}
          openSheet={p.openSheet}
        />
      </div>
    );
  }

  /* ---------- HUD 文案 ---------- */

  const camRunning = camState === "running";
  const sensorChip = (() => {
    if (hs.tiltDegraded) return { text: "朝向不穩", tone: "" };
    if (hs.semantic === "relative-euler") return { text: "需校正", tone: "warn" };
    if (hs.quality === "unavailable") return { text: "無感測", tone: "bad" };
    if (hs.quality === "uncertain") return { text: "感測弱", tone: "warn" };
    return { text: "感測✓", tone: "good" };
  })();

  const hint = hs.tiltDegraded
    ? "方位已暫停，拿正手機即可恢復。"
    : !sensorLive
      ? "等待方向感測資料…請拿起手機，輕輕轉動一下。"
      : hs.semantic === "relative-euler"
        ? "此裝置只提供相對方位，盤面已調暗。請按「校正」對準已知方位。"
        : hs.quality === "uncertain"
          ? "感測精度不足，盤面已調暗。請遠離金屬與電器後按「校正」。"
          : "";

  const selStar = sector !== null && p.wheel ? p.wheel[sector] : null;
  const selPalace = sector !== null ? PALACES.find((x) => x.deg === sector) ?? null : null;

  return (
    <div className="scene" ref={hostRef}>
      <div className="scene-media" />
      <div className="scene-tint" />
      <div className="scene-vignette" />
      <div className="scene-scrim top" />
      <div className="scene-scrim bottom" />

      <header className="ar-top">
        <button className="person-pill" onClick={() => p.openSheet("persons")} aria-label="人物切換">
          <span className="person-pill-name">{p.person?.name ?? "建立人物"}</span>
          <span className="person-pill-kua">
            {p.mingGua
              ? `${KUA_TABLE[p.mingGua.kua].name}・${KUA_TABLE[p.mingGua.kua].group === "east4" ? "東四" : "西四"}命`
              : "—"}
          </span>
        </button>

        <div className="heading-hud">
          <div className="heading-hud-main">
            <span className="heading-deg">{viewHeading !== null ? `${Math.round(viewHeading) % 360}°` : "—"}</span>
            <span className="heading-dir">{palace?.branch ?? "—"}</span>
          </div>
          <div className="heading-hud-sub">
            {hs.tiltDegraded
              ? "方位已凍結"
              : hs.semantic === "relative-euler"
                ? "相對方位・需校正"
                : p.settings.northReference === "true"
                  ? "真北"
                  : "磁北"}
            {offsetActive && <span>｜偏移 {signedOffset(heading.manualOffsetDeg)}</span>}
          </div>
        </div>

        <button className="icon-btn top-gear" aria-label="設定" onClick={() => p.openSheet("settings")}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.56V21h-4v-.04A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3v-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3h4v.04A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1H21v4h-.04A1.7 1.7 0 0 0 19.4 15z" />
          </svg>
        </button>
      </header>

      <div className="status-chips">
        <span className={`chip ${sensorChip.tone}`}>{sensorChip.text}</span>
        <button
          className={`chip chip-btn ${camRunning ? "good" : "warn"}`}
          onClick={() => void startCam()}
          title="點此重新啟動後置相機"
        >
          {camRunning
            ? "相機✓"
            : camState === "ended"
              ? "相機中斷"
              : camState === "failed"
                ? "相機失敗"
                : "相機啟動中…"}
        </button>
        <button className={`chip chip-btn ${offsetActive ? "warn" : ""}`} onClick={() => setCalOpen(true)}>
          校正
        </button>
      </div>

      {(hint || nearBoundary) && (
        <div className="ar-desc">
          {nearBoundary && !hint && (
            <div className="ar-warn">接近方位交界（距邊界 {boundaryDist!.toFixed(1)}°），吉凶可能跳動。</div>
          )}
          {hint}
        </div>
      )}

      {p.initialSensorPermission === "prompt" && (
        <div className="sensor-prompt glass glass-strong">
          <b>需要方向感測</b>
          <p>手機需要你點一下才能啟用「動作與方向」，腳下的八宅盤才會跟著方位轉動。</p>
          <button className="btn primary" onClick={() => void p.requestSensor()}>啟用方向感測</button>
        </div>
      )}

      <footer className="ar-bottom">
        <button className="ar-round" onClick={() => p.openSheet("persons")} aria-label="人物">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
          </svg>
          <span>人物</span>
        </button>

        <button
          className={`shutter ${capturePending ? "is-busy" : ""}`}
          onClick={() => void capture()}
          disabled={!camRunning || capturePending}
          aria-label="拍照（原始＋AR 合成）"
        >
          <span className="shutter-ring">
            <span className="shutter-core" />
          </span>
          <span className="shutter-label">{capturePending ? "處理中…" : "拍照"}</span>
        </button>

        <button className="ar-round" onClick={() => p.openSheet("analysis")} aria-label="命卦方位">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" />
          </svg>
          <span>命卦</span>
        </button>
      </footer>

      {/* 扇區資訊卡：傳統解讀＋方位依據＋佈局參考（規格 9） */}
      <BottomSheet
        key={sector ?? "none"}
        open={sector !== null && selStar !== null}
        onClose={closeSector}
        title={selStar && selPalace ? `${STARS[selStar].name}・${selPalace.branch}方` : "方位資訊"}
        subtitle={
          sector !== null ? `${Math.round(normalizeDeg(sector - 22.5))}°–${Math.round(normalizeDeg(sector + 22.5))}° 扇區` : undefined
        }
      >
        {selStar && selPalace && (
          <div className="track-detail">
            <div className="track-status-line">
              <span className={`status-badge status-${status === "home-center" ? "confirmed-home" : status}`}>
                {floorStatusText(status)}
              </span>
              <span className="track-confidence">{STAR_SHORT[selStar]}</span>
            </div>
            <p className="track-lead serif">{STARS[selStar].name}</p>
            <p className="track-desc">{STAR_DESC[selStar]}</p>
            <div className="track-grid">
              <div><span>方位</span><b>{selPalace.branch}方（{selPalace.name}）</b></div>
              <div><span>吉凶</span><b>{isGoodStar(selStar) ? "吉方" : "凶方"}</b></div>
              <div><span>角度範圍</span><b>{Math.round(normalizeDeg(sector! - 22.5))}°–{Math.round(normalizeDeg(sector! + 22.5))}°</b></div>
              <div><span>依據</span><b>{status === "home-center" ? "住宅中心＋感測" : status === "heading-ref" ? "目前位置＋感測" : "資料不足"}</b></div>
            </div>
            <h3>方位依據</h3>
            <p className="track-note">
              {status === "home-center"
                ? "你已確認站在住宅中心附近，且方向感測良好；此扇區為以住宅中心為圓心換算出的方位。"
                : status === "heading-ref"
                  ? "此盤以你所站位置為圓心，依手機方位換算。它是朝向參考，不代表整戶住宅的正式宮位判定。"
                  : "目前方位資料不夠可靠（感測弱、相對方位或朝向不穩），盤面已調暗；請先校正。"}
            </p>
            <h3>佈局參考</h3>
            <p className="track-note">{STAR_LAYOUT[selStar]}</p>
            <p className="track-note">吉凶為傳統文化參考，非科學驗證的因果事實。</p>
            <div className="track-actions">
              <button className="btn primary" onClick={() => { closeSector(); setCalOpen(true); }}>校正方位</button>
              <button className="btn" onClick={closeSector}>關閉</button>
            </div>
          </div>
        )}
      </BottomSheet>

      <CalibrationModal
        open={calOpen}
        onClose={() => setCalOpen(false)}
        calibrateTo={heading.calibrateTo}
        manualOffsetDeg={heading.manualOffsetDeg}
        tiltDegraded={hs.tiltDegraded}
        onReset={() => heading.setManualOffsetDeg(0)}
        showToast={p.showToast}
      />

      <div className="visually-hidden" role="status" aria-live="polite">
        {trusted && star && palace ? `${palace.branch}方 ${STARS[star].name} ${isGoodStar(star) ? "吉方" : "凶方"}` : ""}
      </div>
    </div>
  );
}
