/**
 * AR 主畫面（決策 30B）：頂部人物／方向、中央全螢幕實景＋Sticker、底部拍照／人物／設定。
 *
 * 資料誠實性：
 * - 相機＋方向感測為 AR 的必要條件（決策 20A），缺任一即顯示停止畫面，非 AR 功能保留。
 * - 模型尚未下載不停止 AR：仍顯示相機與已知方向，不顯示物件標籤（規格 5／11）。
 * - 鏡頭朝天／地時凍結方位與判定（移植原版規則）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { KUA_TABLE, computeMingGua, kuaTitle, type KuaInfo, type MingGuaResult } from "../domain/bazhai/mingGua";
import { BOUNDARY_WARN_DEG, PALACES, STARS, isGoodStar, type DirectionDeg, type StarKey } from "../domain/bazhai/bazhai";
import { boundaryDistanceDeg, normalizeDeg } from "../domain/compass/heading";
import { useHeading } from "../sensors/useHeading";
import { useStableSector } from "../sensors/useStableSector";
import { requestOrientationPermission, type SensorPermission } from "../sensors/deviceOrientation";
import { ARPipeline, type PipelineStatus } from "../ar/pipeline";
import { capturePair } from "../capture/capture";
import { makeCaptureRecord } from "../capture/record";
import {
  putPhoto,
  putRecord,
  uuid,
  type AppSettings,
  type DetectionState,
  type Person,
} from "../storage/storage";
import { defOf, GEO_CONFIRM_KINDS, type ObjectKind } from "../vision/labels";
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
  const pipelineRef = useRef<ARPipeline | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [camBlock, setCamBlock] = useState<CameraBlock | null>(null);
  const [trackId, setTrackId] = useState<number | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [capturePending, setCapturePending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const lastGoodHeading = useRef<number | null>(null);
  const appSheetOpenRef = useRef(p.appSheetOpen);
  appSheetOpenRef.current = p.appSheetOpen;

  const sensorBlocked = p.initialSensorPermission === "denied" || p.initialSensorPermission === "unsupported";
  const sensorDenied = p.initialSensorPermission === "denied";
  const stopped = sensorBlocked || camBlock !== null;

  /* ---------- 感測與方位 ---------- */

  const heading = useHeading(!stopped && p.initialSensorPermission === "granted", p.settings.northReference);
  const hs = heading.state;
  const declination = p.settings.northReference === "true" ? p.settings.declinationDeg : 0;
  const adjustedHeading =
    hs.displayHeading !== null ? normalizeDeg(hs.displayHeading + declination) : null;

  const sensorLive = adjustedHeading !== null && hs.quality !== "unavailable";
  const trusted = sensorLive && !hs.tiltDegraded;
  if (trusted && adjustedHeading !== null) lastGoodHeading.current = adjustedHeading;
  const viewHeading = hs.tiltDegraded && lastGoodHeading.current !== null ? lastGoodHeading.current : adjustedHeading;

  const stableSector = useStableSector(viewHeading, hs.tiltDegraded || !sensorLive);
  const star: StarKey | null = stableSector !== null && p.wheel ? p.wheel[stableSector] : null;
  const palace = stableSector !== null ? PALACES.find((x) => x.deg === stableSector) ?? null : null;
  const boundaryDist = viewHeading !== null ? boundaryDistanceDeg(viewHeading) : null;
  const nearBoundary = trusted && boundaryDist !== null && boundaryDist <= BOUNDARY_WARN_DEG;
  const offsetActive = Math.abs(((heading.manualOffsetDeg + 540) % 360) - 180) >= 0.5;

  /* ---------- Pipeline 生命週期 ---------- */

  const handleCamError = useCallback(
    (err: unknown) => {
      const name = (err as DOMException)?.name ?? "failed";
      const block: CameraBlock =
        name === "NotAllowedError"
          ? "denied"
          : name === "NotFoundError" || name === "NotFoundError"
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
    const pipe = pipelineRef.current;
    if (!pipe) return;
    try {
      const ok = await pipe.startCamera();
      if (ok) setCamBlock(null);
    } catch (e) {
      handleCamError(e);
    }
  }, [handleCamError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || sensorBlocked) return;
    const pipe = new ARPipeline(host, {
      onStatus: (s) => setStatus(s),
      onTapTrack: (id) => {
        if (!appSheetOpenRef.current) setTrackId(id);
      },
      onCamEnded: () => p.showToast("相機畫面中斷（可能被其他 App 使用）。點狀態列的「相機中斷」重新開啟"),
    });
    pipelineRef.current = pipe;
    pipe.run();
    void startCam();
    void pipe.ensureModel(); // 背景分階段載入（相機優先）
    return () => {
      pipe.dispose();
      pipelineRef.current = null;
    };
    // startCam 每次 render 都新建會造成重複啟動；此 effect 只依賴 sensorBlocked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorBlocked]);

  // 將最新的方位／住宅狀態送進 pipeline（每次 render 更新，成本低）
  useEffect(() => {
    pipelineRef.current?.setSpatialContext({
      headingDeg: viewHeading,
      quality: hs.quality,
      tiltDegraded: hs.tiltDegraded,
      homeAtCenter: p.settings.homeAtCenter,
      wheel: p.wheel,
    });
  });

  // 頁面進背景：關鏡頭＋暫停運算；回前景：重開
  useEffect(() => {
    const onVis = () => {
      const pipe = pipelineRef.current;
      if (!pipe) return;
      if (document.hidden) {
        pipe.pause();
        pipe.stopCamera();
      } else if (!stopped) {
        void startCam();
        pipe.run();
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

  /* ---------- 貼紙詳情卡（一次一張） ---------- */

  const trackInfo = trackId !== null ? pipelineRef.current?.trackInfo(trackId) ?? null : null;

  useEffect(() => {
    if (trackId === null || trackInfo !== null) return;
    setTrackId(null); // 追蹤已淡出：自動收卡
  }, [trackId, trackInfo]);

  useEffect(() => {
    if (trackId === null) return;
    history.pushState({ bazigfunar: "track" }, "");
    const onPop = () => setTrackId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [trackId]);

  useEffect(() => {
    if (p.appSheetOpen && trackId !== null) setTrackId(null); // 一次只一張卡
  }, [p.appSheetOpen, trackId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTrackId(null);
        setCalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeTrack = useCallback(() => {
    setTrackId(null);
    if (history.state?.bazigfunar === "track") history.back();
  }, []);

  const applyTrackAction = useCallback(
    (action: "confirm-door" | "confirm-window" | "cancel") => {
      const pipe = pipelineRef.current;
      if (!pipe || trackId === null) return;
      if (action === "confirm-door") pipe.confirmTrack(trackId, "door");
      else if (action === "confirm-window") pipe.confirmTrack(trackId, "window");
      else pipe.rejectTrack(trackId);
      p.showToast(
        action === "confirm-door"
          ? "已確認為門（仍依方位狀態標示，不代表住宅宮位已確認）"
          : action === "confirm-window"
            ? "已確認為窗"
            : "已取消此物件",
      );
      closeTrack();
    },
    [trackId, closeTrack, p.showToast],
  );

  /* ---------- 快門：一次產生原始＋AR 合成兩張照片 ---------- */

  const capture = useCallback(async () => {
    const pipe = pipelineRef.current;
    if (!pipe || capturePending) return;
    const frame = pipe.captureVisibleCanvas();
    if (!frame) {
      p.showToast("相機尚未就緒，無法拍照");
      return;
    }
    setCapturePending(true);
    try {
      const stickers = pipe.currentPhotoStickers();
      const now = new Date();
      const good = star !== null && isGoodStar(star);
      const sourceLabel = hs.semantic ? "感測" : "無感測";
      const near = nearBoundary && boundaryDist !== null ? `接近方位交界（距邊界 ${boundaryDist.toFixed(1)}°），吉凶可能跳動` : undefined;

      const info = {
        headline: p.person && p.mingGua && p.kuaInfo
          ? `${p.person.name}｜${kuaTitle(p.mingGua.kua)}（${p.kuaInfo.group === "east4" ? "東四命" : "西四命"}）`
          : "BaziGFun AR｜實景記錄",
        main: star && palace && viewHeading !== null
          ? `${Math.round(viewHeading) % 360}° ${palace.branch}　${STARS[star].name}（${good ? "吉方" : "凶方"}）`
          : "方位未確認（無可信感測資料）",
        meta: `${now.toLocaleString()}｜${p.settings.northReference === "true" ? `真北（磁偏角 ${signedOffset(p.settings.declinationDeg)}）` : "磁北"}｜${sourceLabel}${hs.quality !== "valid" ? "｜可信度：弱" : ""}`,
        warn: near,
        tone: (star ? (good ? "good" : "bad") : "none") as "good" | "bad" | "none",
      };

      const pair = await capturePair(frame, stickers, info);
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
      const detectionState: DetectionState =
        stickers.length === 0
          ? "none"
          : stickers.some((s) => s.status === "住宅宮位已確認")
            ? "confirmed-home"
            : stickers.some((s) => s.status === "朝向參考")
              ? "heading-ref"
              : "pending";
      const rec = makeCaptureRecord({
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
        stickerCount: stickers.length,
        detectionState,
      });
      await putRecord(rec);
      p.onCaptureSaved();
      p.showToast("已拍照並記錄（原始實景＋AR 合成）");
    } catch (e) {
      p.showToast(`拍照失敗：${(e as Error).message}`);
    } finally {
      setCapturePending(false);
    }
  }, [capturePending, star, palace, viewHeading, nearBoundary, boundaryDist, hs, p]);

  /* ---------- 停止畫面 ---------- */

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
            pipelineRef.current?.run();
            void startCam();
          }}
          onRetrySensor={async () => {
            setRetrying(true);
            try {
              const res = await requestOrientationPermission();
              if (res === "granted") window.location.reload(); // 權限就緒後重新進入 AR
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

  const sensorChip = (() => {
    if (hs.tiltDegraded) return { text: "朝向不穩", tone: "" };
    if (hs.semantic === "relative-euler") return { text: "需校正", tone: "warn" };
    if (hs.quality === "unavailable") return { text: "無感測", tone: "bad" };
    if (hs.quality === "uncertain") return { text: "感測弱", tone: "warn" };
    return { text: "感測✓", tone: "good" };
  })();

  const aiChip = (() => {
    if (status?.detector === "ready") {
      const n = status.trackCount;
      const ms = status.inferenceMs !== null ? ` · ${Math.round(status.inferenceMs)}ms` : "";
      return { text: `AI 就緒 · ${n} 物件${ms}`, tone: "good" };
    }
    if (status?.model === "offline-missing") return { text: "AI 離線未快取", tone: "warn" };
    if (status?.model === "failed" || status?.detector === "failed") return { text: "AI 失敗", tone: "warn" };
    return { text: "AI 載入中…", tone: "" };
  })();

  const desc = hs.tiltDegraded
    ? "方位已暫停，拿正手機即可恢復。"
    : !sensorLive
      ? "等待方向感測資料…桌面瀏覽器通常沒有感測器；你也可使用手動方位工具。"
      : hs.semantic === "relative-euler"
        ? "此裝置只提供相對方位。請按「校正」對準已知方位。"
        : star
          ? STAR_DESC[star]
          : "";

  const track = trackId !== null ? trackInfo : null;
  const trackStar = track?.spatial.star ?? null;
  const trackStatus = track ? track.spatial.status : "pending";
  const isGeo = track?.source === "geo";
  const needsConfirm = isGeo && !track?.spatial; // geo 未確認的資訊由 title 呈現
  const canConfirm = isGeo && trackInfo && !(trackInfo.kind in GEO_CONFIRM_KINDS);
  void needsConfirm;
  void canConfirm;

  return (
    <div className="scene" ref={hostRef}>
      <div className="scene-media" />
      <div className="scene-scrim top" />
      <div className="scene-scrim bottom" />

      <header className="ar-top">
        <button
          className="person-pill"
          onClick={() => p.openSheet("persons")}
          aria-label="人物切換"
        >
          <span className="person-pill-name">{p.person?.name ?? "建立人物"}</span>
          <span className="person-pill-kua">
            {p.mingGua ? `${KUA_TABLE[p.mingGua.kua].name}${KUA_TABLE[p.mingGua.kua].group === "east4" ? "東四" : "西四"}命` : "—"}
          </span>
        </button>

        <div className="heading-hud">
          <div className="heading-hud-main">
            <span className="heading-deg">{viewHeading !== null ? `${Math.round(viewHeading) % 360}°` : "—"}</span>
            <span className="heading-dir">{palace?.branch ?? "—"}</span>
            {star && (
              <span className={`heading-star ${isGoodStar(star) ? "good" : "bad"} ${trusted ? "" : "is-dim"}`}>
                {STARS[star].name}
              </span>
            )}
          </div>
          <div className="heading-hud-sub">
            {hs.tiltDegraded ? "方位已凍結" : hs.semantic === "relative-euler" ? "相對方位・需校正" : p.settings.northReference === "true" ? "真北" : "磁北"}
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
        <span className={`chip ${sensorChip.tone}`} title="方向感測狀態">{sensorChip.text}</span>
        <button
          className={`chip chip-btn ${status?.camRunning ? "good" : "warn"}`}
          onClick={() => void startCam()}
          title="點此重新啟動後置相機"
        >
          {status?.camRunning
            ? "相機✓"
            : status?.camState === "ended"
              ? "相機中斷"
              : status?.camState === "denied"
                ? "相機拒絕"
                : status?.camState === "failed"
                  ? "相機失敗"
                  : "相機啟動中…"}
        </button>
        <span className={`chip ${aiChip.tone}`}>{aiChip.text}</span>
        {offsetActive && (
          <button className="chip chip-btn warn" onClick={() => setCalOpen(true)}>校正</button>
        )}
        {!offsetActive && (
          <button className="chip chip-btn" onClick={() => setCalOpen(true)}>校正</button>
        )}
      </div>

      <div className="ar-desc">
        {nearBoundary && <div className="ar-warn">接近方位交界（距邊界 {boundaryDist!.toFixed(1)}°），吉凶可能跳動。</div>}
        {desc}
      </div>

      {p.initialSensorPermission === "prompt" && (
        <div className="sensor-prompt glass glass-strong">
          <b>需要方向感測</b>
          <p>iPhone 需要你點一下才能啟用「動作與方向」，才會顯示方位吉凶。</p>
          <button className="btn primary" onClick={() => void p.requestSensor()}>啟用方向感測</button>
        </div>
      )}

      {/* 懸浮式備援（決策 1D）：沒有辨識到物件時，仍顯示目前朝向的八宅提示；只標「朝向參考」，不宣稱物件或住宅宮位 */}
      {trusted && star && palace && (status?.trackCount ?? 0) === 0 && (
        <button
          className={`ar-float tone-${isGoodStar(star) ? "good" : "bad"}`}
          onClick={() => p.openSheet("analysis")}
          aria-label={`${palace.branch}方 ${STARS[star].name}，點擊查看命卦方位`}
        >
          <span className="ar-sticker-title">{palace.branch}方 · {STARS[star].name}</span>
          <span className="ar-sticker-sub">{STAR_SHORT[star]}</span>
          <span className="ar-sticker-status">朝向參考</span>
        </button>
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
          disabled={!status?.camRunning || capturePending}
          aria-label="拍照（原始＋AR 合成）"
        >
          <span className="shutter-ring">
            <span className="shutter-core" />
          </span>
          <span className="shutter-label">{capturePending ? "處理中…" : "拍照"}</span>
        </button>

        <button className="ar-round" onClick={() => p.openSheet("settings")} aria-label="設定">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
            <circle cx="18" cy="17" r="2.4" />
          </svg>
          <span>設定</span>
        </button>
      </footer>

      {/* 貼紙詳情卡：傳統解讀＋方位依據＋佈局參考（規格 9） */}
      <BottomSheet
        key={trackId ?? "none"}
        open={trackId !== null && track !== null}
        onClose={closeTrack}
        title={trackStar ? `${STARS[trackStar].name}・${track?.spatial.palaceBranch ?? ""}方` : "物件資訊"}
        subtitle={isGeo ? "幾何候選・待確認" : `影像辨識・${defOf((track?.kind ?? "door") as ObjectKind).zh}`}
      >
        {track && (
          <div className="track-detail">
            <div className="track-status-line">
              <span className={`status-badge status-${trackStatus}`}>
                {trackStatus === "confirmed-home" ? "住宅宮位已確認" : trackStatus === "heading-ref" ? "朝向參考" : "待確認"}
              </span>
              <span className="track-confidence">辨識可信度 {Math.round(track.score * 100)}%</span>
            </div>

            {trackStar ? (
              <>
                <p className="track-lead serif">{STARS[trackStar].name}</p>
                <p className="track-desc">{STAR_DESC[trackStar]}</p>
                <div className="track-grid">
                  <div><span>方位</span><b>{track.spatial.palaceBranch ?? "—"}方</b></div>
                  <div><span>角度</span><b>{track.spatial.bearingDeg !== null ? `${Math.round(track.spatial.bearingDeg)}°` : "—"}</b></div>
                  <div><span>吉凶</span><b>{isGoodStar(trackStar) ? "吉方" : "凶方"}</b></div>
                  <div><span>依據</span><b>{trackStatus === "confirmed-home" ? "住宅中心＋感測" : trackStatus === "heading-ref" ? "鏡頭朝向" : "資料不足"}</b></div>
                </div>
                <h3>方位依據</h3>
                <p className="track-note">
                  {trackStatus === "confirmed-home"
                    ? "你已確認站於住宅幾何中心附近，且方向感測良好；此標記表示依你提供的住宅中心與北向推得的宮位。"
                    : trackStatus === "heading-ref"
                      ? "此為鏡頭朝向的參考方位；物件出現在畫面中，不代表該物件已確認位於住宅的此一宮位。"
                      : "資料不足（方位不確定或物件尚未確認），不給確定吉凶。"}
                  {track.spatial.nearBoundary && " 目前接近方位交界，吉凶可能跳動。"}
                </p>
                <h3>佈局參考</h3>
                <p className="track-note">{STAR_LAYOUT[trackStar]}</p>
              </>
            ) : (
              <p className="track-desc">此為從畫面邊緣擷取的幾何候選，尚未確認類別。請確認為門或窗，或取消此候選；確認前不給任何吉凶判斷。</p>
            )}

            <p className="track-note">拖曳貼紙可修正位置；吉凶為傳統文化參考，非科學驗證的因果事實。</p>

            <div className="track-actions">
              {isGeo && (
                <>
                  <button className="btn primary" onClick={() => applyTrackAction("confirm-door")}>確認為門</button>
                  <button className="btn" onClick={() => applyTrackAction("confirm-window")}>確認為窗</button>
                </>
              )}
              <button className="btn" onClick={() => applyTrackAction("cancel")}>取消此物件</button>
              <button className="btn" onClick={closeTrack}>關閉</button>
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

      {/* 螢幕閱讀器：只在方位改變時播報 */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {trusted && star && palace ? `${palace.branch}方 ${STARS[star].name} ${isGoodStar(star) ? "吉方" : "凶方"}` : ""}
      </div>
    </div>
  );
}
