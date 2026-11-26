/**
 * 拍照紀錄組裝（規格 10）：原始實景照與 AR 合成照共享同一筆紀錄 ID。
 * 純函式，可單元測試；schemaVersion 版本化，未來可讀。
 */
import { SCHEMA_VERSION, type DetectionState, type PhotoRecordMeta } from "../storage/storage";
import type { Quality } from "../domain/compass/heading";

export interface CaptureRecordParts {
  id: string;
  rawId: string;
  arId: string;
  personId: string;
  now: Date;
  title: string;
  azimuthRaw: number | null;
  azimuthDisplay: number | null;
  source: "sensor" | "manual" | "none";
  northReference: "magnetic" | "true";
  palace: string;
  star: string;
  quality: Quality;
  nearBoundary: boolean;
  stickerCount: number;
  detectionState: DetectionState;
}

export function makeCaptureRecord(p: CaptureRecordParts): PhotoRecordMeta {
  return {
    id: p.id,
    personId: p.personId,
    title: p.title,
    note: "",
    capturedAt: p.now.toISOString(),
    azimuthRaw: p.azimuthRaw,
    azimuthDisplay: p.azimuthDisplay,
    source: p.source,
    northReference: p.northReference,
    palace: p.palace,
    star: p.star,
    quality: p.quality,
    nearBoundary: p.nearBoundary,
    photoId: p.rawId,
    arPhotoId: p.arId,
    stickerCount: p.stickerCount,
    detectionState: p.detectionState,
    schemaVersion: SCHEMA_VERSION,
  };
}
