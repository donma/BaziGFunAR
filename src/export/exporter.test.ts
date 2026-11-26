import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildExportJSON } from "./exporter";
import type { PhotoRecordMeta } from "../storage/storage";

const record: PhotoRecordMeta = {
  id: "rec-1",
  personId: "p-1",
  title: "西北・伏位",
  note: "",
  capturedAt: "2026-11-26T12:34:56.000Z",
  azimuthRaw: 315,
  azimuthDisplay: 315,
  source: "sensor",
  northReference: "magnetic",
  palace: "乾",
  star: "fuWei",
  quality: "valid",
  nearBoundary: false,
  photoId: "raw-1",
  arPhotoId: "ar-1",
  stickerCount: 2,
  detectionState: "heading-ref",
  schemaVersion: 2,
};

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        schemaVersion: 2,
        persons: [{ id: "p-1", name: "小明", birthDate: "1991-06-15", birthTime: null, sex: "female", kua: 6, createdAt: "" }],
        settings: { northReference: "magnetic", declinationDeg: 0, manualOffsetDeg: 0, currentPersonId: "p-1", homeAtCenter: false, homeSetAt: null },
      }),
    setItem: () => undefined,
  });
});

describe("匯出格式版本化（規格 10）", () => {
  it("JSON 含 persons、settings 與雙照片記錄，格式版本 2", async () => {
    const data = JSON.parse(await buildExportJSON([record]).text());
    expect(data.formatVersion).toBe(2);
    expect(data.app).toBe("bazigfun-ar");
    expect(data.schemaVersion).toBe(2);
    expect(data.persons[0].name).toBe("小明");
    expect(data.records[0].rawPhotoId).toBe("raw-1");
    expect(data.records[0].arPhotoId).toBe("ar-1");
    expect(data.records[0].detectionState).toBe("heading-ref");
  });

  it("photos 清單同時包含 raw 與 ar，檔案路徑版本化", async () => {
    const data = JSON.parse(await buildExportJSON([record]).text());
    expect(data.photos).toHaveLength(2);
    expect(data.photos.map((p: { kind: string }) => p.kind).sort()).toEqual(["ar", "raw"]);
    expect(data.photos[0].file).toMatch(/^photos\/(raw|ar)\/[^/]+\.jpg$/);
  });

  it("無照片的舊紀錄不會產生空的照片項目", async () => {
    const data = JSON.parse(await buildExportJSON([{ ...record, photoId: "", arPhotoId: "" }]).text());
    expect(data.photos).toHaveLength(0);
  });
});
