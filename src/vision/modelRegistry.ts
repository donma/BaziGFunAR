/**
 * 模型資產管理（規格 11）：
 * - 本機辨識，不呼叫雲端 AI API；模型權重以 HTTP 取得後經 Service Worker runtime 快取離線。
 * - 先下載、逐項驗證成功，才視為「就緒」；驗證失敗不上報就緒（規格 11：失敗時保留誠實狀態）。
 * - 瀏覽器清除快取後，下次有網路進 AR 會自動重新下載；離線且無快取 → 狀態 offline-missing，
 *   AR 仍可顯示相機與方向，但不出現物件標籤（規格 11：不輸出不存在的 AI 物件定位結果）。
 *
 * 版本：MODEL_VERSION 變更時改用新的 SW 快取名（bazigfunar-models-v<N>），舊版快取保留供回退。
 */

export const MODEL_VERSION = 1;
export const MODEL_CACHE_NAME = `bazigfunar-models-v${MODEL_VERSION}`;

/** COCO-SSD lite_mobilenet_v2 權重（@tensorflow-models/coco-ssd 的預設來源，pin 版本 URL） */
export const MODEL_BASE_URL = "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2";
export const MODEL_JSON_URL = `${MODEL_BASE_URL}/model.json`;

export type ModelState =
  | "idle" // 尚未開始（相機優先載入中）
  | "loading" // 下載／驗證中
  | "ready" // 已快取且驗證通過，可離線
  | "offline-missing" // 離線且快取無模型（誠實提示，不假裝可用）
  | "failed"; // 有網路但下載／驗證失敗

export interface ModelStatus {
  state: ModelState;
  /** 已驗證資產數／總數 */
  assetsDone: number;
  assetsTotal: number;
  /** 驗證通過的總位元組數（診斷） */
  bytes: number;
  message?: string;
}

export interface ModelAsset {
  url: string;
  /** 驗證規則 */
  validate: (res: Response, body: ArrayBuffer | string) => boolean;
}

function validateJson(_res: Response, body: ArrayBuffer | string): boolean {
  try {
    const text = typeof body === "string" ? body : new TextDecoder().decode(body);
    const j = JSON.parse(text) as { weightsManifest?: unknown[]; modelTopology?: unknown };
    return Array.isArray(j.weightsManifest) && j.weightsManifest.length > 0;
  } catch {
    return false;
  }
}

function validateShard(_res: Response, body: ArrayBuffer | string): boolean {
  const buf = typeof body === "string" ? new TextEncoder().encode(body).buffer : body;
  return buf instanceof ArrayBuffer && buf.byteLength > 1024; // 權重 shard 至少 KB 級
}

/**
 * 由 model.json 解析所有權重 shard URL，建立完整資產清單。
 * 動態解析（而非寫死 shard 名稱）可避免 shard 數量變動造成漏抓。
 */
export function assetsFromModelJson(jsonText: string, baseUrl: string): ModelAsset[] {
  const j = JSON.parse(jsonText) as {
    weightsManifest?: Array<{ paths?: string[] }>;
  };
  const paths = new Set<string>();
  for (const g of j.weightsManifest ?? []) {
    for (const p of g.paths ?? []) paths.add(p);
  }
  const assets: ModelAsset[] = [{ url: baseUrl, validate: validateJson }];
  // shard 路徑相對於 model.json 所在「目錄」，不是 model.json 本身
  const dir = baseUrl.endsWith("/") ? baseUrl : baseUrl.replace(/\/[^/]*$/, "/");
  for (const p of paths) {
    assets.push({ url: new URL(p, dir).toString(), validate: validateShard });
  }
  return assets;
}

/** 取單一資產：先嘗試（會經 SW runtime 快取），驗證失敗且線上時重抓一次 */
async function ensureAsset(asset: ModelAsset): Promise<{ ok: boolean; bytes: number }> {
  let res = await fetch(asset.url, { mode: "cors", cache: "force-cache" });
  let body: ArrayBuffer | string | null = null;
  if (res.ok) {
    body = await res.clone().arrayBuffer().catch(() => null);
    if (body !== null && asset.validate(res, body)) return { ok: true, bytes: (body as ArrayBuffer).byteLength };
  }
  // 驗證失敗：線上則 no-store 重抓一次（可能快取到半截檔案）
  if (navigator.onLine) {
    res = await fetch(asset.url, { mode: "cors", cache: "reload" });
    if (res.ok) {
      body = await res.arrayBuffer().catch(() => null);
      if (body !== null && asset.validate(res, body)) return { ok: true, bytes: (body as ArrayBuffer).byteLength };
    }
  }
  return { ok: false, bytes: 0 };
}

export class ModelRegistry {
  private status: ModelStatus = { state: "idle", assetsDone: 0, assetsTotal: 0, bytes: 0 };
  private listeners = new Set<(s: ModelStatus) => void>();
  private running: Promise<boolean> | null = null;

  get(): ModelStatus {
    return this.status;
  }

  onChange(cb: (s: ModelStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  private set(patch: Partial<ModelStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const cb of this.listeners) cb(this.status);
  }

  /**
   * 確保模型資產已快取且驗證通過。回傳 true 表示可載入偵測器。
   * 併發呼叫共用同一個執行。
   */
  ensureReady(): Promise<boolean> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<boolean> {
    this.set({ state: "loading", assetsDone: 0, assetsTotal: 0, bytes: 0, message: undefined });
    if (!navigator.onLine) {
      // 離線：靠 SW 快取直接驗證 model.json 是否可得
      const cached = await this.tryValidateCached();
      if (cached) {
        this.set({ state: "ready", message: "使用已快取模型" });
        return true;
      }
      this.set({ state: "offline-missing", message: "離線且模型未快取，僅顯示實景與方位" });
      return false;
    }
    try {
      const jsonRes = await fetch(MODEL_JSON_URL, { mode: "cors", cache: "no-store" });
      if (!jsonRes.ok) throw new Error(`model.json HTTP ${jsonRes.status}`);
      const jsonText = await jsonRes.text();
      if (!validateJson(jsonRes, jsonText)) throw new Error("model.json 驗證失敗");
      const assets = assetsFromModelJson(jsonText, MODEL_JSON_URL);
      let bytes = jsonText.length;
      let done = 1;
      this.set({ assetsTotal: assets.length, assetsDone: done, bytes });
      for (const asset of assets.slice(1)) {
        const r = await ensureAsset(asset);
        if (!r.ok) throw new Error(`權重下載或驗證失敗：${asset.url}`);
        bytes += r.bytes;
        done++;
        this.set({ assetsDone: done, bytes });
      }
      this.set({ state: "ready", bytes, message: "模型就緒（已快取，可離線）" });
      return true;
    } catch (e) {
      // 失敗時仍嘗試以快取驗證（可能只是網路不穩但快取完整）
      const cached = await this.tryValidateCached();
      if (cached) {
        this.set({ state: "ready", message: "使用已快取模型" });
        return true;
      }
      this.set({ state: "failed", message: `模型下載失敗：${(e as Error).message}` });
      return false;
    }
  }

  private async tryValidateCached(): Promise<boolean> {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(MODEL_JSON_URL);
      if (!hit) return false;
      const text = await hit.text();
      if (!validateJson(hit, text)) return false;
      const assets = assetsFromModelJson(text, MODEL_JSON_URL);
      for (const a of assets.slice(1)) {
        const m = await cache.match(a.url);
        if (!m) return false;
        const buf = await m.clone().arrayBuffer();
        if (!a.validate(m, buf)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
