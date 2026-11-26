/**
 * 主應用：首次引導 → AR 主畫面（頂部人物/方向、中央實景、底部拍照/人物/設定，決策 30B）。
 * 全域彈出層（人物／紀錄／設定／命盤／手動方位工具）與返回鍵、Esc、Toast 集中管理。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KUA_TABLE, computeMingGua, type MingGuaResult, type KuaInfo } from "../domain/bazhai/mingGua";
import { bazhaiWheel, type DirectionDeg } from "../domain/bazhai/bazhai";
import { detectCapabilities, requestOrientationPermission, type SensorPermission } from "../sensors/deviceOrientation";import {
  deleteRecordWithPhotos,
  getPhoto,
  listRecords,
  loadLS,
  saveLS,
  uuid,
  type AppSettings,
  type LSData,
  type Person,
  type PhotoRecordMeta,
} from "../storage/storage";
import { ARScreen } from "./ARScreen";
import { Onboarding } from "./Onboarding";
import { ManualCompass } from "./ManualCompass";
import { PersonSheet } from "./sheets/PersonSheet";
import { RecordsSheet } from "./sheets/RecordsSheet";
import { SettingsSheet } from "./sheets/SettingsSheet";
import { AnalysisSheet } from "./sheets/AnalysisSheet";
import { PhotoDetailModal } from "./sheets/PhotoDetail";
import type { SheetKind } from "./types";

export type Modal = SheetKind | { kind: "photo"; photoId: string } | null;

export interface ToastApi {
  showToast: (msg: string) => void;
}

export default function App() {
  const [ls, setLs] = useState<LSData>(() => loadLS());
  const [view, setView] = useState<"onboarding" | "ar">(() => (loadLS().persons.length === 0 ? "onboarding" : "ar"));
  const [modal, setModal] = useState<Modal>(null);
  const [sensorPermission, setSensorPermission] = useState<SensorPermission>(() => {
    const caps = detectCapabilities();
    if (!caps.hasDeviceOrientation) return "unsupported";
    // 非 iOS 13+：不需要請求權限，直接視為可用（先前漏了這一步，導致感測從未啟動）
    return caps.hasRequestPermission ? "prompt" : "granted";
  });
  const [toast, setToast] = useState<string | null>(null);
  const [records, setRecords] = useState<PhotoRecordMeta[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const urlsRef = useRef<string[]>([]);

  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /* ---------- 人物 ---------- */

  const persist = useCallback(
    (next: LSData) => {
      setLs(next);
      try {
        saveLS(next);
      } catch {
        showToast("無法寫入本機儲存空間，變更可能不會保留");
      }
    },
    [showToast],
  );

  const addPerson = useCallback(
    (name: string, birthDate: string, birthTime: string | null, sex: "male" | "female"): Person => {
      const r = computeMingGua({ birthDate, birthTime, sex });
      const person: Person = {
        id: uuid(),
        name,
        birthDate,
        birthTime,
        sex,
        kua: r.kua,
        createdAt: new Date().toISOString(),
      };
      persist({
        ...ls,
        persons: [...ls.persons, person],
        settings: { ...ls.settings, currentPersonId: person.id },
      });
      if (r.boundaryUncertain) showToast("生日接近立春交界，建議補出生時間以確定命卦");
      return person;
    },
    [ls, persist, showToast],
  );

  const editPerson = useCallback(
    (id: string, name: string, birthDate: string, birthTime: string | null, sex: "male" | "female") => {
      try {
        const r = computeMingGua({ birthDate, birthTime, sex });
        persist({
          ...ls,
          persons: ls.persons.map((p) =>
            p.id === id ? { ...p, name, birthDate, birthTime, sex, kua: r.kua } : p,
          ),
        });
        if (r.boundaryUncertain) showToast("生日接近立春交界，建議補出生時間以確定命卦");
        showToast("人物已更新");
      } catch (e) {
        showToast((e as Error).message);
      }
    },
    [ls, persist, showToast],
  );

  const removePerson = useCallback(
    (id: string) => {
      persist({
        ...ls,
        persons: ls.persons.filter((p) => p.id !== id),
        settings: {
          ...ls.settings,
          currentPersonId: ls.settings.currentPersonId === id ? null : ls.settings.currentPersonId,
        },
      });
    },
    [ls, persist],
  );

  const selectPerson = useCallback(
    (id: string) => persist({ ...ls, settings: { ...ls.settings, currentPersonId: id } }),
    [ls, persist],
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => persist({ ...ls, settings: { ...ls.settings, ...patch } }),
    [ls, persist],
  );

  /* ---------- 目前人物與命卦 ---------- */

  const currentPerson: Person | null =
    ls.persons.find((p) => p.id === ls.settings.currentPersonId) ?? ls.persons[0] ?? null;

  const mingGua: MingGuaResult | null = useMemo(() => {
    if (!currentPerson) return null;
    try {
      return computeMingGua({
        birthDate: currentPerson.birthDate,
        birthTime: currentPerson.birthTime,
        sex: currentPerson.sex,
      });
    } catch {
      return null;
    }
  }, [currentPerson]);

  const wheel = useMemo(() => (mingGua ? bazhaiWheel(mingGua.kua) : null), [mingGua]);
  const kuaInfo: KuaInfo | null = mingGua ? KUA_TABLE[mingGua.kua] : null;

  /* ---------- 紀錄縮圖 ---------- */

  const refreshRecords = useCallback(async () => {
    try {
      setRecords(await listRecords());
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    void refreshRecords();
  }, [refreshRecords]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urls: Record<string, string> = {};
      const created: string[] = [];
      for (const r of records.slice(0, 30)) {
        const id = r.photoId || r.arPhotoId;
        if (!id) continue;
        const ph = await getPhoto(id).catch(() => undefined);
        if (ph) {
          const u = URL.createObjectURL(ph.blob);
          urls[id] = u;
          created.push(u);
        }
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = created;
      setPhotoUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [records]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const deleteRecord = useCallback(
    async (id: string) => {
      const rec = records.find((r) => r.id === id);
      if (rec) await deleteRecordWithPhotos(rec);
      await refreshRecords();
      showToast("紀錄已刪除");
    },
    [records, refreshRecords, showToast],
  );

  /* ---------- 方向感測權限（iOS 需在使用者手勢中請求；Android／桌面無需請求） ---------- */

  const requestSensor = useCallback(async () => {
    const res = await requestOrientationPermission();
    // 決策 20A：方向能力不可用時停止 AR（不在缺少感測能力的裝置上偷偷顯示不可靠 AR）
    const caps = detectCapabilities();
    const effective: SensorPermission = res === "granted" && !caps.hasDeviceOrientation ? "unsupported" : res;
    setSensorPermission(effective);
    if (effective === "denied") {
      showToast("方向感測權限被拒絕；AR 已停止，可在設定中重新授權");
    }
  }, [showToast]);

  const enterAR = useCallback(async () => {
    await requestSensor();
    setView("ar");
  }, [requestSensor]);

  /* ---------- 返回鍵與 Esc：先關閉卡片／彈出層 ---------- */

  useEffect(() => {
    if (!modal) return;
    history.pushState({ bazigfunar: "modal" }, "");
    const onPop = () => setModal(null);
    window.addEventListener("popstate", onPop);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [modal]);

  const closeModal = useCallback(() => {
    setModal(null);
    // 我們曾 pushState：以 history.back() 收掉該筆紀錄（popstate 會再 setModal(null)，無副作用）
    if (history.state?.bazigfunar === "modal") history.back();
  }, []);

  const openSheet = useCallback((kind: SheetKind) => setModal(kind), []);
  const openPhoto = useCallback((photoId: string) => setModal({ kind: "photo", photoId }), []);
  const modalOpen = modal !== null;

  /* ---------- 畫面 ---------- */

  return (
    <>
      {view === "onboarding" ? (
        <Onboarding
          onAddPerson={addPerson}
          personCount={ls.persons.length}
          onFinish={() => void enterAR()}
        />
      ) : (
        <ARScreen
          person={currentPerson}
          mingGua={mingGua}
          wheel={wheel}
          kuaInfo={kuaInfo}
          settings={ls.settings}
          updateSettings={updateSettings}
          openSheet={openSheet}
          appSheetOpen={modalOpen}
          initialSensorPermission={sensorPermission}
          requestSensor={requestSensor}
          showToast={showToast}
          onCaptureSaved={refreshRecords}
        />
      )}

      <PersonSheet
        open={modal === "persons"}
        onClose={closeModal}
        ls={ls}
        selectPerson={selectPerson}
        removePerson={removePerson}
        addPerson={addPerson}
        editPerson={editPerson}
      />
      <RecordsSheet
        open={modal === "records"}
        onClose={closeModal}
        records={records}
        photoUrls={photoUrls}
        onOpenPhoto={openPhoto}
        onDelete={deleteRecord}
        showToast={showToast}
      />
      <SettingsSheet
        open={modal === "settings"}
        onClose={closeModal}
        settings={ls.settings}
        updateSettings={updateSettings}
        openSheet={openSheet}
        showToast={showToast}
      />
      <AnalysisSheet
        open={modal === "analysis"}
        onClose={closeModal}
        person={currentPerson}
        mingGua={mingGua}
        wheel={wheel}
      />
      {modal === "manual" && (
        <ManualCompass
          person={currentPerson}
          mingGua={mingGua}
          wheel={wheel}
          settings={ls.settings}
          updateSettings={updateSettings}
          onClose={closeModal}
          showToast={showToast}
        />
      )}
      <PhotoDetailModal
        open={modal !== null && typeof modal === "object" && modal.kind === "photo" ? modal.photoId : null}
        records={records}
        onClose={closeModal}
        onDelete={deleteRecord}
        showToast={showToast}
      />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {/* 給螢幕閱讀器的人物狀態 */}
      <div className="visually-hidden" role="status" aria-live="polite">
        {currentPerson && mingGua ? `${currentPerson.name}，${KUA_TABLE[mingGua.kua].name}卦` : ""}
      </div>
    </>
  );
}
