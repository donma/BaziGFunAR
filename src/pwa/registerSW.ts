/**
 * Service Worker 註冊（vite-plugin-pwa autoUpdate，策略沿用原版已驗證機制）：
 * 新版 SW 在背景下載、快取完成後由 SW 自己 skipWaiting + clientsClaim 接管並自動重載一次；
 * 不依賴頁面按鈕，也不會「每次進頁面就強制換頁」。
 */
import { registerSW } from "virtual:pwa-register";

let forceUpdate: (() => Promise<void>) | null = null;

export function registerSWWithUpdatePrompt(): void {
  const update = registerSW({
    onNeedRefresh() {
      void update(); // 保險：真的出現 waiting 時立即更新
    },
    onOfflineReady() {
      console.info("[BaziGFunAR] 離線快取完成，可離線使用");
    },
  });
  forceUpdate = update;
}

export function requestUpdate(): Promise<void> {
  return forceUpdate ? forceUpdate() : Promise.resolve();
}

export { registerSW };

/**
 * 強制載入最新版：解除 Service Worker 並清除「程式快取」後重新載入。
 * 不會動 localStorage（人物／設定）與 IndexedDB（照片／紀錄）。
 */
export async function hardRefresh(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}
