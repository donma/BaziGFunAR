import { describe, it, expect } from "vitest";
import { makeCaptureRecord, photoFileName } from "./record";

const base = {
  id: "record-1",
  rawId: "raw-1",
  arId: "ar-1",
  personId: "person-1",
  now: new Date("2026-11-26T12:34:56.000Z"),
  title: "西北・伏位",
  azimuthRaw: 315,
  azimuthDisplay: 315,
  source: "sensor" as const,
  northReference: "magnetic" as const,
  palace: "乾",
  star: "fuWei",
  quality: "valid" as const,
  nearBoundary: false,
  stickerCount: 2,
  detectionState: "heading-ref" as const,
};

describe("雙照片紀錄（規格 10）", () => {
  it("原始照與 AR 合成照以不同 ID 保存，但同屬一筆紀錄", () => {
    const r = makeCaptureRecord(base);
    expect(r.id).toBe("record-1");
    expect(r.photoId).toBe("raw-1");
    expect(r.arPhotoId).toBe("ar-1");
    expect(r.photoId).not.toBe(r.arPhotoId);
  });

  it("版本化 schema 與時間格式", () => {
    const r = makeCaptureRecord(base);
    expect(r.schemaVersion).toBe(2);
    expect(r.capturedAt).toBe("2026-11-26T12:34:56.000Z");
  });

  it("誠實保存定位狀態與貼紙數", () => {
    const r = makeCaptureRecord({ ...base, detectionState: "confirmed-home", stickerCount: 3 });
    expect(r.detectionState).toBe("confirmed-home");
    expect(r.stickerCount).toBe(3);
    const none = makeCaptureRecord({ ...base, detectionState: "none", stickerCount: 0 });
    expect(none.detectionState).toBe("none");
  });

  it("無方位資料時 azimuthDisplay 可為 null（不假造 0°）", () => {
    const r = makeCaptureRecord({ ...base, azimuthDisplay: null, azimuthRaw: null, source: "none", star: "", palace: "—" });
    expect(r.azimuthDisplay).toBeNull();
    expect(r.source).toBe("none");
  });
});

describe("自動下載檔名", () => {
  it("以本機時間產生可排序的檔名；raw 版加 -raw", () => {
    const d = new Date(2026, 10, 27, 9, 5, 7); // 本機時間 2026-11-27 09:05:07
    expect(photoFileName(d)).toBe("bazigfun-ar-20261127-090507.jpg");
    expect(photoFileName(d, "raw")).toBe("bazigfun-ar-20261127-090507-raw.jpg");
  });
});
