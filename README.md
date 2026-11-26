# BaziGFun AR 八宅實景

> 手機優先、操作極簡、盡量全自動的**離線 PWA 八宅實景 AR**。
> 以靜態立體貼紙＋物件光框取代傳統羅盤；人物、命卦、八宅、感測、校正、拍照、紀錄、匯出等功能完整 inherited 自原版 BaziGFun。
>
> **本機優先・離線可用・不上傳任何個人資料。**

⚠️ **誠實邊界**：八宅風水為傳統文化參考，不是科學驗證的因果事實。純 PWA **不具備**原生 ARKit 等級的空間錨定保證；本 App 明確區分「鏡頭朝向参考」與「住宅宮位已確認」，物件出現在畫面中**不代表**已確認其住宅宮位。

---

## 快速開始

```bash
npm install            # 或 npm ci
npm test               # 107 個單元測試（含原版核心演算法一致性）
npm run dev            # http://localhost:5173/BaziGFunAR/
npm run build          # 型別檢查＋正式建置（dist/）+ Service Worker
npm run preview        # http://localhost:4173/BaziGFunAR/
npm run smoke          # 真瀏覽器端到端煙霧測試（需先 preview 或 dev）
npm run icons          # 重新產生 PWA 圖示
```

需要 Node.js 20+（本機驗證：Node v24.16.0 / npm 11）。相機與方向感測需 **HTTPS 或 localhost**；手機實機請部署到 HTTPS 網址（例如 GitHub Pages）。

### 部署

- `vite.config.ts` 已設定 `base: "/BaziGFunAR/"`，manifest 的 `start_url`／`scope` 與 SW `navigateFallback` 同步。
- GitHub Pages：build output = `dist/`，Actions 先跑 `npm test` 再 `npm run build`；Pages Source 請設為 GitHub Actions。
- 靜態託管（Cloudflare Pages 等）：Build `npm run build`，Output `dist`，不需後端、資料庫或 AI 雲端服務。

---

## 畫面與操作

```
┌───────────────────────────────┐
│ [小明 乾西四命]  [315° 西北 伏位] [⚙] │  頂部：人物／方位／設定
│  [無感測] [相機✓] [AI就緒] [校正]   │
│  等待方向感測資料…（或八星解讀）      │
│                               │
│     全螢幕後置相機＋物件光框        │  中央：實景＋靜態立體貼紙
│     ┌── 五鬼 / 留意口舌變動 ──┐     │
│     │   朝向參考  · 乾宮       │     │
│     └────────────────────────┘     │
│                               │
│    [人物]     ◉ 拍照     [設定]     │  底部：快門一次產生兩張照片
└───────────────────────────────┘
```

- 點貼紙 → 底部資訊卡（預設 35%，上滑全展開、下滑收合；返回鍵先關卡）：吉凶解讀、方位依據、佈局參考、修正類別／取消。
- 貼紙可拖曳修正位置；點「校正」以已知方位校正；設定可切磁北／真北（需自行提供磁偏角）與住宅定位。
- **權限不足即停止 AR**（決策 20A）：畫面顯示原因與重新授權入口，人物／紀錄／命盤／手動方位工具仍可使用。
- 相機／方向／模型三者狀態各自標示，不混淆「模型未下載」與「必要權限不足」。

---

## 功能與決策落實

| 決策 | 落實位置 |
|---|---|
| 1D 混合式、3B 立體貼紙＋光框、13A 靜態無光效 | `src/ar/stickerRenderer.ts`、`src/styles/ar.css` |
| 2B 離鏡頭隱藏、12B 淡出 | `src/tracking/tracker.ts`（fading → gone） |
| 4B 間歇辨識、19B 自動效能 | `src/ar/perf.ts`（4 級自動調整，無用戶設定） |
| 5B 一次一張資訊卡、16B Bottom Sheet | `src/app/ui.tsx`、`src/app/ARScreen.tsx` |
| 7C 方位與物件整合、25A 標籤區分 | `src/ar/spatial.ts` |
| 8B 點擊修正類別／位置／取消 | `StickerRenderer` pointer 事件＋`ARPipeline.confirmTrack/rejectTrack/nudge` |
| 9B／11B／15C 待確認標記、2–4 標籤、自適應尺寸 | `src/ar/stickerLayout.ts` |
| 14A 無地板投影、20A 權限不足停止 AR | `src/app/ARStopped.tsx`；無地板套件 |
| 17B 原始＋AR 雙照片、10 版本化 | `src/capture/capture.ts`、`src/capture/record.ts` |
| 18B／22B／23B 本機模型＋背景分階段 | `src/vision/*`、`src/vision/modelRegistry.ts` |
| 21A 每次重新辨識 | ARPipeline 每次掛載新建，不存 3D 錨點 |
| 24B／29A 選用住宅定位／新專案新人物 | `SettingsSheet`、`Onboarding`；無舊版匯入 |
| 30B 精簡手機 UI | `ARScreen`＋Bottom Sheet |

## 系統分層

```
src/domain/    命理核心（逐字移植原版）：立春天文、命卦、大遊年八宅、方位幾何
src/sensors/   方向感測（逐字移植）：能力偵測、iOS 權限、濾波、校正、退化
src/camera/    getUserMedia 生命週期、與畫面一致的 cover 裁切（逐字移植）
src/vision/    TF.js + COCO-SSD 本機偵測、模型版本快取（門窗幾何候選程式保留但預設關閉）
src/tracking/  IoU 匹配＋速度平滑＋遮擋淡出
src/ar/        空間解讀、貼紙版面、自動效能、pipeline、DOM 渲染器
src/capture/   原始＋AR 合成照、紀錄組裝
src/storage/   localStorage persons/settings + IndexedDB photos/records（schema v2）
src/export/    JSON / JPEG / ZIP（fflate）/ Web Share 降級
src/pwa/       Service Worker autoUpdate + 模型 runtime 快取
src/app/       手機 UI、Bottom Sheet、手動方位工具、設定
```

核心計算皆為純函式，UI 不自行硬編吉凶；原版 64 個核心測試案例**逐字移植**、全部通過，表示相同輸入得到相同結果。

## 物件辨識的真實能力

- **模型支援**：床、沙發、桌子（COCO `dining table`）、椅子、電視、冰箱、水槽（COCO-SSD `lite_mobilenet_v2`，本機 TF.js 推論）。
- **不支援門／窗**：COCO-SSD 沒有門窗類別。曾實作「幾何候選＋人機確認」，但實測雜訊太多（牆角、櫃子、畫框都被當候選），**已預設關閉**（`ENABLE_GEOMETRIC_CANDIDATES = false`），目前**不辨識門窗**，規格 6 所說的「明確註記限制」即指此項。
- **地板／牆面**：第一版不提供吉凶投影或牆面貼紙（決策 14A，且不偽裝模型能力）。
- 模型權重約 **18.6 MB**（model.json 0.5 MB＋5 個 shard 共 18.0 MB），首次需網路下載；成功後由 Service Worker 快取，離線可用。驗證失敗不啟用、離線無快取時如實提示，只顯示相機與方位。

## 空間定位與吉凶可信度

| 資料 | 來源 |
|---|---|
| 鏡頭朝向 | 感測器＋校正＋磁偏角（可切真北），近垂直時凍結 |
| 物件影像位置 | 2D 偵測框，僅表示在畫面哪裡 |
| 住宅空間位置 | 僅在使用者確認站於住宅中心且感測有效、遠離交界時，才標「住宅宮位已確認」 |
| 八宅吉凶 | 人物命卦＋大遊年規則；不是分類器輸出 |

一般模式（預設）只顯示「{星}方 · 朝向參考」；資料不足或交界 ±2° 顯示「待確認」。貼紙視覺附著於畫面物件，但**不表示**該物件已確認位於住宅宮位。

---

## 測試與驗證結果（本機實際執行）

| 項目 | 結果 |
|---|---|
| `npm test` | **13 個檔案、107 個測試全數通過**（含原版移植的核心一致性案例 64 個） |
| `npm run build` | 通過；產出 manifest、SW、precache 18 項（約 2.27 MB）、模型 CacheFirst 規則 |
| `npm run smoke`（Edge 真瀏覽器，假相機） | 引導→人物→AR；相機✓、AI 就緒、零 console 錯誤；快門產生 1 筆紀錄＋2 張照片（raw/ar，schema 2）；`bazigfunar-models-v1` 快取存在、SW 接管 |
| 原版是否修改 | **未修改**（只讀取並逐字複製必要檔案；原版目錄保持原狀） |

手機實機（iPhone Safari／Android Chrome）、辨識率、10 分鐘穩定性與實測幀率仍待執行，詳見 `docs/poc-plan.md` 與 `docs/acceptance.md`。**本專案不憑空承認百分比辨識準確度。**

## 已知限制

1. 尚未完成 iPhone／Android 實機量測；此版本不宣稱特定辨識率、漂移值或支援機型清單。
2. 目前**不辨識門窗**（COCO-SSD 無此類別；幾何候選實測雜訊過多已關閉）。
3. 物件方位的畫面角位移以概估水平視角（62°）換算；住宅宮位標記依賴使用者提供「站在中心」與感測品質，不是原生空間錨定。
4. 模型首次下載約 18.6 MB；瀏覽器清除快取後需重新下載。關閉 PWA 不保證背景下載持續。
5. 真北需使用者自行提供當地磁偏角；App 內建查證用的立春覆寫表，但沒有內建磁偏角資料。
6. 不提供舊版人物 JSON 匯入、雲端同步、帳號、地板吉凶投影。
7. 本機資料可能因清除網站資料而遺失，請定期匯出 ZIP。

## 版本

App 1.0.0｜命卦引擎 `minggua-bazhai-1.0.0`｜八宅 `bazhai-dayou-1.0.0`｜立春 `lichun-astro-1.0.0`｜Storage schema 2｜Export format 2｜Model version 1
