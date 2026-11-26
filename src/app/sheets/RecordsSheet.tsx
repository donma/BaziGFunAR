/** 拍照紀錄：原始＋AR 合成雙照片、單張分享、ZIP／JSON 匯出、刪除。 */
import { STARS, type StarKey } from "../../domain/bazhai/bazhai";
import { buildExportJSON, exportZip, exportSinglePhotoJpeg, shareOrDownload } from "../../export/exporter";
import type { PhotoRecordMeta } from "../../storage/storage";
import { BottomSheet } from "../ui";

export function RecordsSheet(p: {
  open: boolean;
  onClose: () => void;
  records: PhotoRecordMeta[];
  photoUrls: Record<string, string>;
  onOpenPhoto: (photoId: string) => void;
  onDelete: (id: string) => void;
  showToast: (msg: string) => void;
}) {
  const doZip = async () => {
    try {
      const res = await exportZip();
      await shareOrDownload(res.filename, res.blob);
      p.showToast("匯出完成（此版本不支援匯入還原）");
    } catch (e) {
      p.showToast(`匯出失敗：${(e as Error).message}`);
    }
  };
  const doJson = async () => {
    try {
      await shareOrDownload("bazigfun-ar-data.json", buildExportJSON(p.records));
      p.showToast("JSON 已匯出");
    } catch (e) {
      p.showToast(`匯出失敗：${(e as Error).message}`);
    }
  };

  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="拍照紀錄" subtitle={`共 ${p.records.length} 筆｜兩張照片同屬一筆紀錄`}>
      <div className="btn-row">
        <button className="btn" onClick={() => void doJson()}>匯出 JSON</button>
        <button className="btn primary" onClick={() => void doZip()}>匯出 ZIP</button>
      </div>
      <p className="hint">⚠️ 僅供匯出保存，不支援匯入還原；所有處理都在本機。</p>

      {p.records.map((r) => {
        const star = r.star ? STARS[r.star as StarKey] : undefined;
        const rawUrl = p.photoUrls[r.photoId];
        const arUrl = p.photoUrls[r.arPhotoId];
        return (
          <div className="list-card record-card" key={r.id}>
            <button className="record-open" onClick={() => p.onOpenPhoto(r.photoId)} aria-label={`查看 ${r.title} 的完整照片與詳情`}>
              <div className="thumb-pair">
                {rawUrl ? <img className="thumb" src={rawUrl} alt={`${r.title} 原始實景`} /> : <div className="thumb" />}
                {arUrl && <img className="thumb thumb-ar" src={arUrl} alt={`${r.title} AR 合成`} />}
              </div>
              <div className="list-main">
                <div className="list-title">{r.title}</div>
                <div className="list-sub">
                  {new Date(r.capturedAt).toLocaleString()}・{r.azimuthDisplay !== null ? `${Math.round(r.azimuthDisplay)}°` : "無方位"}・{r.palace}・
                  <span className={star ? `star-${star.luck}` : undefined}>{star?.name ?? "無吉凶"}</span>
                </div>
                <div className="list-tags">
                  <span className="mini-tag">原始＋AR</span>
                  <span className="mini-tag">{r.detectionState === "confirmed-home" ? "住宅宮位已確認" : r.detectionState === "heading-ref" ? "朝向參考" : r.detectionState === "pending" ? "待確認" : "無貼紙"}</span>
                </div>
              </div>
            </button>
            <div className="list-actions">
              <button
                className="btn mini-btn"
                onClick={async () => {
                  const res = await exportSinglePhotoJpeg(r.arPhotoId || r.photoId);
                  if (res) await shareOrDownload(res.filename, res.blob);
                }}
              >
                分享
              </button>
              <button className="btn mini-btn danger" onClick={() => p.onDelete(r.id)}>刪除</button>
            </div>
          </div>
        );
      })}
      {p.records.length === 0 && <p className="hint">尚無紀錄。進入 AR 按快門即可建立。</p>}
    </BottomSheet>
  );
}
