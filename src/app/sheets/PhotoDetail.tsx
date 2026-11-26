/** 照片詳情：原始實景／AR 合成切換、完整紀錄資訊、分享與刪除。 */
import { useEffect, useState } from "react";
import { STARS, type StarKey } from "../../domain/bazhai/bazhai";
import { exportSinglePhotoJpeg, shareOrDownload } from "../../export/exporter";
import { getPhoto, type PhotoRecordMeta } from "../../storage/storage";
import { CenterModal } from "../ui";

export function PhotoDetailModal({
  open,
  records,
  onClose,
  onDelete,
  showToast,
}: {
  open: string | null;
  records: PhotoRecordMeta[];
  onClose: () => void;
  onDelete: (id: string) => void;
  showToast: (msg: string) => void;
}) {
  const record = open ? records.find((r) => r.photoId === open || r.arPhotoId === open) ?? null : null;
  const [tab, setTab] = useState<"raw" | "ar">("raw");
  const [urls, setUrls] = useState<{ raw: string | null; ar: string | null }>({ raw: null, ar: null });

  useEffect(() => {
    if (!record) {
      setUrls({ raw: null, ar: null });
      return;
    }
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const [raw, ar] = await Promise.all([
        getPhoto(record.photoId).catch(() => undefined),
        getPhoto(record.arPhotoId).catch(() => undefined),
      ]);
      const next = {
        raw: raw ? URL.createObjectURL(raw.blob) : null,
        ar: ar ? URL.createObjectURL(ar.blob) : null,
      };
      if (raw) created.push(next.raw!);
      if (ar) created.push(next.ar!);
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setUrls(next);
      setTab("raw");
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [record]);

  const star = record?.star ? STARS[record.star as StarKey] : undefined;
  const good = star?.luck === "good";
  const rows: Array<[string, string]> = record
    ? [
        ["方位", `${record.azimuthDisplay !== null ? `${Math.round(record.azimuthDisplay)}° ` : "無方位"}${record.palace}`],
        ["吉凶", star ? `${star.name}（${good ? "吉方" : "凶方"}）` : "無（無可信方位）"],
        ["時間", new Date(record.capturedAt).toLocaleString()],
        ["來源", record.source === "manual" ? "手動方位" : record.source === "sensor" ? "方向感測" : "無感測"],
        ["北向基準", record.northReference === "true" ? "真北（使用者磁偏角）" : "磁北"],
        ["可信度", record.quality === "valid" ? "良好" : record.quality === "uncertain" ? "需校正／不確定" : "無法判定"],
        ["定位狀態", record.detectionState === "confirmed-home" ? "住宅宮位已確認" : record.detectionState === "heading-ref" ? "朝向參考" : record.detectionState === "pending" ? "待確認" : "無貼紙"],
        ["貼紙數", String(record.stickerCount)],
        ...(record.nearBoundary ? ([["方位交界", "接近交界（吉凶可能跳動）"]] as Array<[string, string]>) : []),
      ]
    : [];

  const share = async (id: string) => {
    const res = await exportSinglePhotoJpeg(id);
    if (res) {
      await shareOrDownload(res.filename, res.blob);
      showToast("照片已匯出");
    }
  };

  return (
    <CenterModal open={!!record} onClose={onClose} title={record?.title ?? "照片詳情"} wide>
      <div className="detail-tabs">
        <button className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>原始實景</button>
        <button className={tab === "ar" ? "on" : ""} onClick={() => setTab("ar")}>AR 合成</button>
      </div>
      <div className="detail-photo-wrap">
        {urls[tab] ? (
          <img className="detail-photo" src={urls[tab]!} alt={tab === "raw" ? "原始實景照片" : "AR 合成照片"} />
        ) : (
          <p className="hint">照片讀取中或已不存在</p>
        )}
      </div>
      {rows.length > 0 && (
        <dl className="detail-info">
          {rows.map(([k, v]) => (
            <div className="detail-info-row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="btn-row detail-actions">
        <button className="btn" onClick={() => void share(tab === "raw" ? record!.photoId : record!.arPhotoId)}>分享這張</button>
        <button
          className="btn"
          onClick={() => {
            if (record) onDelete(record.id);
            onClose();
          }}
        >
          刪除這筆
        </button>
      </div>
    </CenterModal>
  );
}
