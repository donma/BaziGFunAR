import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // GitHub Pages 專案頁面掛在 /BaziGFunAR/ 子路徑；本機 dev 仍由 Vite 自動處理
  base: "/BaziGFunAR/",
  plugins: [
    react(),
    VitePWA({
      // 與原版相同策略：新版 SW 背景安裝＋快取完成後自動 skipWaiting + clientsClaim 接管並重載，
      // 不需要頁面按鈕；只有在新版「已完整快取好了」才更新一次。
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "BaziGFun AR 八宅實景",
        short_name: "BaziGFun AR",
        description: "八宅命卦實景 AR 貼紙（本機離線，不上傳資料）",
        lang: "zh-Hant",
        display: "standalone",
        orientation: "any",
        theme_color: "#16110a",
        background_color: "#16110a",
        start_url: "/BaziGFunAR/",
        scope: "/BaziGFunAR/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // tfjs 懶載入 chunk 較大，放寬預先快取上限，讓「辨識程式碼」也離線可用
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/BaziGFunAR/index.html",
        runtimeCaching: [
          {
            // 模型權重（COCO-SSD lite_mobilenet_v2）：第一次線上載入成功後即離線可用。
            // 模型管理器（modelRegistry）會在下載後逐項驗證，失敗不啟用、離線時誠實提示。
            urlPattern: new RegExp("^https://storage\\.googleapis\\.com/tfjs-models/.*"),
            handler: "CacheFirst",
            options: {
              cacheName: "bazigfunar-models-v1",
              expiration: { maxEntries: 12, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: false,
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    css: { include: [/\.css\?raw$/] },
  },
  server: {
    watch: { ignored: ["**/scripts/.cache/**"] },
  },
});
