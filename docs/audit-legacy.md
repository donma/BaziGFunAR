# 原版 BaziGFun 稽核與繼承對照表

> 依規格書第 4 節與第 17 節的施工前必要工作產出。
> 原版路徑：`D:\AI_PROJECTS\BaziGFun`（**原版零改動**，本專案只讀取、不寫入）。
> 稽核日期：2026-11-26。原版版本：1.0.0（minggua-bazhai-1.0.0 / bazhai-dayou-1.0.0 / lichun-astro-1.0.0 / schema 1）。

## 1. 原版程式結構盤點（實際程式碼，非文件推定）

| 原版檔案 | 內容 | 稽核結果 |
|---|---|---|
| `src/domain/bazhai/lichun.ts` | 立春交節天文計算（Meeus 低階太陽視黃經＋牛頓迭代）＋ 2000/2012/2023–2026 覆寫表 | 純函式、版本化，含測試錨點 |
| `src/domain/bazhai/mingGua.ts` | 命卦：立春年界（Asia/Taipei UTC+8）、位數縮減、男 11−s／女 4+s、五黃寄宮（男坤二／女艮八）、KUA_TABLE、干支年 | 純函式、版本化 |
| `src/domain/bazhai/bazhai.ts` | 後天八卦八方（0/45/…/315°）、大遊年歌、八星表、扇區映射、邊界距離（BOUNDARY_WARN_DEG=2） | 純函式、版本化 |
| `src/domain/compass/heading.ts` | 角度正規化、圓形低通、扇區遲滯、姿態幾何（歐拉角→相機朝向/仰角）、磁偏角、TILT_DEGRADED=65° | 純函式 |
| `src/sensors/deviceOrientation.ts` | 能力偵測、iOS `requestPermission`、事件解讀（webkitCompassHeading／absolute） | 事件層 |
| `src/sensors/headingProcessor.ts` | 樣本→HeadingState：來源語義、濾波 0.22、品質判定、WEBKIT_ACCURACY_OK=30° | 純邏輯 |
| `src/sensors/useHeading.ts` | React hook：rAF 合併、新鮮度（webkit 3s／euler 20s）、人工偏移（濾波後套用）、calibrateTo | hook |
| `src/sensors/useStableSector.ts` | 扇區遲滯 1.5°、凍結時暫停切換 | hook |
| `src/camera/cameraManager.ts` | getUserMedia(environment 1920×1080)、啟停競態保證、外力中斷 onEnded、暫時性錯誤重試 | 生命週期完備 |
| `src/camera/coverCrop.ts` | 與螢幕 object-fit:cover 一致的裁切計算 | 純函式 |
| `src/camera/composite.ts` | 拍照合成：cover 裁切＋SVG 羅盤＋資訊卡 → JPEG（內嵌字體 data URI） | 舊版羅盤專用 |
| `src/storage/storage.ts` | localStorage `bazigfun.v1`（persons/settings）＋ IndexedDB `bazigfun`（photos/records） | schema v1 |
| `src/export/exporter.ts` | JSON／單張 JPEG／ZIP（fflate, level 0）／Web Share 降級 | 無匯入 |
| `src/pwa/registerSW.ts` | vite-plugin-pwa autoUpdate（新版快取完成後自動接管重載） | |
| `src/app/App.tsx` | 主狀態機：onboarding/compass；方位五態（locked/manual/live/stale/demo）；拍照；校正；抽屜；照片詳情；wakeLock；theme-color 切換 | |
| `src/app/Onboarding.tsx` | 三步引導：建立人物→權限→進入 | |
| `src/app/panels.tsx` | 側欄三分頁：命卦方位／人物（新增/切換/刪除）／紀錄 | **原版無「編輯人物」** |
| `src/app/parts.tsx` | BrandBar、PersonCard、HeadingCard、ActionRow | 呈現元件 |
| `src/analysis/MingGuaPanel.tsx` | 命卦卡＋上北下南 3×3 方位圖＋簡介＋免責 | |
| `src/components/BaguaDial.tsx` | 傳統圓形羅盤 SVG | AR 版主畫面不採用（決策 3/14） |
| `src/app/layout.ts` | 常駐側欄 media query（920/1140/viewport-segments） | |
| `src/styles/*.css` | 禪意米色/深褐設計 token、玻璃卡、safe-area | 設計語言延用 |

## 2. 舊版功能 → 新版功能 → 測試案例

| # | 舊版功能（程式碼證據） | 新版對應 | 測試案例（自動化） |
|---|---|---|---|
| 1 | 立春天文計算＋覆寫表（lichun.ts） | `domain/bazhai/lichun.ts` 原文移植 | `lichun.test.ts`：4 錨點誤差<600s、覆寫 0 誤差、年份落點、2026/2000 台北日期 |
| 2 | 命卦＋五黃寄宮（mingGua.ts） | 同左，原文移植 | `mingGua.test.ts`：人工核對表 9 例、五黃寄宮、八命全覆蓋、東西四命分組、干支、kuaTitle |
| 3 | 大遊年八方吉凶（bazhai.ts） | 同左，原文移植 | `mingGua.test.ts`：乾命八方全表、坎命八方、卦象一致、每命四吉四凶、扇區 ±ε、邊界距離 |
| 4 | 角度工具／姿態幾何／遲滯（heading.ts） | 同左，原文移植 | `heading.test.ts`：正規化、0/360 濾波、遲滯 5 案例、仰角、橫式、滾轉 30°、朝天退化回 null、磁偏角 |
| 5 | 感測解讀與品質（deviceOrientation＋headingProcessor） | 同左，原文移植 | `headingProcessor.test.ts`：三種語義、精度門檻、退化、平滑、偏移後套、交界提示、中斷門檻 |
| 6 | 手動校正（calibrateTo、偏移後套、重置） | AR 設定＋手動方位工具繼承同一校正邏輯 | `headingProcessor.test.ts`（偏移）；UI 手動驗收 |
| 7 | 相機生命週期（cameraManager） | `camera/cameraManager.ts` 原文移植 | `cameraManager` 行為於 AR pipeline 整合驗收（真機）；生命週期保證寫在程式註解與碼內斷言 |
| 8 | cover 裁切與螢幕一致（coverCrop） | 同左，原文移植；並作為辨識輸入座標映射 | `coverCrop.test.ts`：4 案例全數移植 |
| 9 | 拍照＋紀錄（composite/storage） | `capture/capture.ts`＋`capture/record.ts`：一次快門產出**原始實景＋AR 合成**兩張，同一筆紀錄 ID（規格 10） | `capture/record.test.ts`：兩張不同 ID 同紀錄、schema v2、狀態誠實；`exporter.test.ts`：雙照片匯出 |
| 10 | 匯出 ZIP/JSON/單張/Share（exporter） | `export/exporter.ts` 擴充：raw/ar 雙照片、formatVersion 2 | `exporter.test.ts`：JSON 結構、照片清單雙筆、檔名對應 |
| 11 | 人物新增/切換/刪除（panels.tsx） | `PersonSheet`：新增/**編輯**（規格 4 要求，舊版無）/切換/刪除，命卦重算 | UI 驗收＋`mingGua.test.ts` 保證重算一致 |
| 12 | 命卦方位分析面板（MingGuaPanel） | `AnalysisSheet` 原樣移植（3×3 方位圖＋簡介＋免責） | UI 驗收 |
| 13 | 磁北基準、真北未提供（誠實標示） | 繼承：預設磁北；**真北＝使用者輸入磁偏角**後啟用（applyDeclination 移植），不冒充 | `heading.test.ts`（applyDeclination） |
| 14 | 方位交界提醒（≤2°）＋遲滯 1.5° | 同左，原文移植 | `heading.test.ts`／`headingProcessor.test.ts` |
| 15 | 鏡頭朝天/地凍結（tiltDegraded） | 同左，原文移植；AR 中凍結 sticker 判定 | `headingProcessor.test.ts` |
| 16 | PWA autoUpdate＋離線 | 同左（vite-plugin-pwa autoUpdate）＋模型 runtime 快取 | `npm run build` 產物檢查；SW 更新流程沿用原版已驗證機制 |
| 17 | WakeLock、theme-color、safe-area、RWD 直橫式 | 全部繼承 | UI 驗收 |
| 18 | 無感測「示範方位」誠實標示 | AR 停止畫面（決策 20A）＋手動方位工具 | UI 驗收 |
| 19 | 舊版人物 JSON 匯入 | **不提供**（決策 29A），UI 明示 | — |

## 3. 核心演算法一致性基準

新版 `src/domain/**`、`src/sensors/**`、`src/camera/coverCrop.ts` 為**逐字移植**（僅改 import 路徑），並移植原版全部 64+ 個單元測試案例（同輸入同期望值）。`npm test` 即為一致性驗證：**相同測試輸入在兩版得到相同命卦與吉凶結果**。已知無原版錯誤需要相容性決策（人工核對表全數通過）。

## 4. 原版存在但新 UI 不採用的項目（規格 1 允許）

| 項目 | 處置 | 依據 |
|---|---|---|
| 傳統圓形羅盤作為 AR 主畫面（BaguaDial） | 主畫面改為實景＋Sticker＋光框 | 決策 3/14；羅盤完整退場，方位以 HUD 呈現 |
| 手動羅盤為主畫面模式 | 保留為非 AR 的「手動方位工具」（AR 停止時可進入） | 決策 20A（AR 必要權限不足即停止）＋規格 1「不得無故移除業務功能」 |
| 持續呼吸光／粒子特效 | 不導入（本來就沒有，明文不加入） | 決策 13A |
