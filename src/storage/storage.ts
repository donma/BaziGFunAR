/**
 * localStorage + IndexedDB 儲存層（schema v2，BaziGFun AR 專用）。
 * 人物/設定 → localStorage；照片 Blob（原始實景＋AR 合成）、紀錄 → IndexedDB。
 *
 * 與原版差異（版本化，不共用 key／資料庫，避免與原版互相污染）：
 * - LS_KEY / IDB 名稱改為 bazigfunar（決策 29A：新專案重新建立人物，不繼承舊資料）。
 * - 設定新增：磁偏角（真北模式）、住宅定位（站在住宅中心）確認狀態。
 * - 紀錄新增：arPhotoId（AR 合成照）與 rawPhotoId（原始實景照）同繫一筆紀錄（規格 10）、
 *   辨識狀態 detectionState（規格 7 的四種資料區分）。
 */
import type { KuaNumber } from "../domain/bazhai/mingGua";

export const SCHEMA_VERSION = 2;
export const LS_KEY = "bazigfunar.v2";
export const IDB_NAME = "bazigfunar";
export const IDB_VERSION = 1;

export interface Person {
  id: string;
  name: string;
  birthDate: string; // YYYY-MM-DD
  birthTime: string | null; // HH:mm
  sex: "male" | "female";
  /** 命卦由版本化引擎計算後快取（顯示用）；編輯人物時重算 */
  kua: KuaNumber;
  createdAt: string;
}

/**
 * 辨識／定位狀態（規格 7：誠實區分資料來源）。
 * - "heading-ref"：朝向參考（依鏡頭方向推得，不代表物件已確認位於住宅宮位）
 * - "confirmed-home"：住宅宮位已確認（住宅中心確認＋感測 valid＋遠離扇區交界）
 * - "pending"：待確認（資料不足，淡金色中性標記）
 * - "none"：拍照當下無可標示物件
 */
export type DetectionState = "heading-ref" | "confirmed-home" | "pending" | "none";

export interface PhotoRecordMeta {
  id: string;
  personId: string;
  title: string;
  note: string;
  capturedAt: string; // ISO 8601
  azimuthRaw: number | null;
  azimuthDisplay: number | null;
  source: "sensor" | "manual" | "none";
  northReference: "magnetic" | "true";
  palace: string;
  star: string;
  quality: "valid" | "uncertain" | "unavailable";
  nearBoundary: boolean;
  /** 原始實景照片（不含任何 AR 內容） */
  photoId: string;
  /** AR 合成照片（與 raw 同一影格對齊的 Sticker 與光框；可能與 raw 相同內容若無 sticker） */
  arPhotoId: string;
  /** 拍照當下的 AR 標籤數 */
  stickerCount: number;
  /** 拍照當下的辨識／定位狀態 */
  detectionState: DetectionState;
  schemaVersion: number;
}

export interface AppSettings {
  northReference: "magnetic" | "true";
  /** 真北模式的磁偏角（度，東偏為正）；由使用者提供，非內建資料，介面會標明來源 */
  declinationDeg: number;
  /** 人工校正偏移（僅本次執行有效；此欄位僅供匯出對照，不跨次套用） */
  manualOffsetDeg: number;
  currentPersonId: string | null;
  /** 使用者確認目前站在住宅幾何中心附近（規格 7：住宅精確定位的前置條件） */
  homeAtCenter: boolean;
  homeSetAt: string | null;
}

export interface LSData {
  schemaVersion: number;
  persons: Person[];
  settings: AppSettings;
}

export function defaultSettings(): AppSettings {
  return {
    northReference: "magnetic",
    declinationDeg: 0,
    manualOffsetDeg: 0,
    currentPersonId: null,
    homeAtCenter: false,
    homeSetAt: null,
  };
}

export function loadLS(): LSData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { schemaVersion: SCHEMA_VERSION, persons: [], settings: defaultSettings() };
    const data = JSON.parse(raw) as LSData;
    return migrateLS(data);
  } catch {
    return { schemaVersion: SCHEMA_VERSION, persons: [], settings: defaultSettings() };
  }
}

function migrateLS(data: LSData): LSData {
  // v2 為初始版本；未來在此依 data.schemaVersion 逐步遷移
  const d = defaultSettings();
  if (!data.settings) data.settings = d;
  if (typeof data.settings.northReference !== "string") data.settings.northReference = d.northReference;
  if (typeof data.settings.declinationDeg !== "number") data.settings.declinationDeg = 0;
  if (typeof data.settings.manualOffsetDeg !== "number") data.settings.manualOffsetDeg = 0;
  if (typeof data.settings.homeAtCenter !== "boolean") data.settings.homeAtCenter = false;
  if (typeof data.settings.homeSetAt !== "string") data.settings.homeSetAt = null;
  if (!Array.isArray(data.persons)) data.persons = [];
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}

export function saveLS(data: LSData): void {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* ---------- IndexedDB ---------- */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" }); // {id, blob, mimeType, createdAt, kind}
      }
      if (!db.objectStoreNames.contains("records")) {
        const s = db.createObjectStore("records", { keyPath: "id" });
        s.createIndex("personId", "personId");
        s.createIndex("capturedAt", "capturedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export type PhotoKind = "raw" | "ar";

export async function putPhoto(id: string, blob: Blob, mimeType: string, kind: PhotoKind): Promise<void> {
  await tx("photos", "readwrite", (s) =>
    s.put({ id, blob, mimeType, kind, createdAt: new Date().toISOString() }),
  );
}

export async function getPhoto(id: string): Promise<{ id: string; blob: Blob; mimeType: string; kind: PhotoKind } | undefined> {
  return tx("photos", "readonly", (s) =>
    s.get(id) as IDBRequest<{ id: string; blob: Blob; mimeType: string; kind: PhotoKind } | undefined>,
  );
}

export async function listPhotos(): Promise<Array<{ id: string; blob: Blob; mimeType: string; kind: PhotoKind; createdAt: string }>> {
  return tx("photos", "readonly", (s) =>
    s.getAll() as IDBRequest<Array<{ id: string; blob: Blob; mimeType: string; kind: PhotoKind; createdAt: string }>>,
  );
}

export async function deletePhoto(id: string): Promise<void> {
  await tx("photos", "readwrite", (s) => s.delete(id));
}

export async function putRecord(r: PhotoRecordMeta): Promise<void> {
  await tx("records", "readwrite", (s) => s.put(r));
}

export async function listRecords(): Promise<PhotoRecordMeta[]> {
  const all = await tx("records", "readonly", (s) => s.getAll() as IDBRequest<PhotoRecordMeta[]>);
  return all.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}

export async function deleteRecord(id: string): Promise<void> {
  await tx("records", "readwrite", (s) => s.delete(id));
}

/** 刪除一筆紀錄與其兩張照片（raw + ar） */
export async function deleteRecordWithPhotos(rec: PhotoRecordMeta): Promise<void> {
  const ids = new Set<string>([rec.photoId, rec.arPhotoId].filter(Boolean));
  for (const id of ids) await deletePhoto(id);
  await deleteRecord(rec.id);
}

export function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage?.estimate) {
    return navigator.storage.estimate().then((e) => ({ usage: e.usage ?? 0, quota: e.quota ?? 0 }));
  }
  return Promise.resolve(null);
}

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r & 0x3 : (r & 0x8) | 0x8).toString(16);
  });
}
