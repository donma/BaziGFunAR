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
