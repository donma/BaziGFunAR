/**
 * 匯出：JSON + 照片（原始實景＋AR 合成雙份）；單張分享／下載；批次 ZIP（fflate）。
 * 全程在本機執行，不上傳任何資料。無匯入（決策 29A）。
 *
 * 版本化命名（規格 10）：照片分 `photos/raw/` 與 `photos/ar/` 兩層，
 * JSON 內以 kind 標示，formatVersion 2，確保未來可讀回。
 */
import { zipSync, type Zippable } from "fflate";
import { SCHEMA_VERSION, loadLS, listPhotos, listRecords, type PhotoRecordMeta } from "../storage/storage";
import { APP_VERSION } from "../app/version";

export interface ExportResult {
  filename: string;
  blob: Blob;
  isZip: boolean;
}

export function buildExportJSON(records: PhotoRecordMeta[]): Blob {
  const ls = loadLS();
  const data = {
    formatVersion: 2,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    app: "bazigfun-ar",
    exportedAt: new Date().toISOString(),
    persons: ls.persons.map((p) => ({
      id: p.id,
      name: p.name,
      birthDate: p.birthDate,
      birthTime: p.birthTime,
      sex: p.sex,
      timezone: "Asia/Taipei",
      kua: p.kua,
    })),
    records: records.map((r) => ({
      id: r.id,
      personId: r.personId,
      title: r.title,
      azimuthDeg: r.azimuthDisplay,
      azimuthRaw: r.azimuthRaw,
      northReference: r.northReference,
      source: r.source,
      quality: r.quality,
      palace: r.palace,
      star: r.star,
      nearBoundary: r.nearBoundary,
      rawPhotoId: r.photoId,
      arPhotoId: r.arPhotoId,
      stickerCount: r.stickerCount,
      detectionState: r.detectionState,
      note: r.note,
      capturedAt: r.capturedAt,
    })),
    photos: records
      .flatMap((r) => {
        const out: Array<{ id: string; file: string; mimeType: string; kind: "raw" | "ar"; recordId: string }> = [];
        if (r.photoId) out.push({ id: r.photoId, file: `photos/raw/${r.photoId}.jpg`, mimeType: "image/jpeg", kind: "raw", recordId: r.id });
        if (r.arPhotoId) out.push({ id: r.arPhotoId, file: `photos/ar/${r.arPhotoId}.jpg`, mimeType: "image/jpeg", kind: "ar", recordId: r.id });
        return out;
      }),
    settings: {
      northReference: ls.settings.northReference,
      declinationDeg: ls.settings.declinationDeg,
      homeAtCenter: ls.settings.homeAtCenter,
    },
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export async function exportZip(): Promise<ExportResult> {
  const [records, photos] = await Promise.all([listRecords(), listPhotos()]);
  const files: Zippable = {};
  const json = await buildExportJSON(records).arrayBuffer();
  files["bazigfun-ar-data.json"] = new Uint8Array(json);
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  for (const r of records) {
    const pairs: Array<[string, "raw" | "ar"]> = [
      [r.photoId, "raw"],
      [r.arPhotoId, "ar"],
    ];
    for (const [pid, kind] of pairs) {
      if (!pid) continue;
      const ph = photoMap.get(pid);
      if (ph) {
        const buf = await ph.blob.arrayBuffer();
        files[`photos/${kind}/${pid}.jpg`] = new Uint8Array(buf);
      }
    }
  }
  const zipped = zipSync(files, { level: 0 }); // JPEG 已壓縮，用 store 避免 CPU 浪費
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return {
    filename: `bazigfun-ar-export-${ymd}.zip`,
    blob: new Blob([zipped as unknown as BlobPart], { type: "application/zip" }),
    isZip: true,
  };
}

export async function exportSinglePhotoJpeg(photoId: string): Promise<ExportResult | null> {
  const ph = (await listPhotos()).find((p) => p.id === photoId);
  if (!ph) return null;
  const suffix = ph.kind === "ar" ? "-ar" : "";
  return { filename: `${photoId}${suffix}.jpg`, blob: ph.blob, isZip: false };
}

/** iOS Share API 優先，不可用時降級為下載連結 */
export async function shareOrDownload(filename: string, blob: Blob): Promise<"shared" | "downloaded"> {
  const nav = navigator as Navigator & {
    canShare?: (d: { files?: File[] }) => boolean;
  };
  const file = new File([blob], filename, { type: blob.type });
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "shared"; // 使用者取消不算失敗
    }
  }
  return downloadBlob(filename, blob);
}

/** 直接以瀏覽器下載（不彈分享選單） */
export function downloadBlob(filename: string, blob: Blob): "downloaded" {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
