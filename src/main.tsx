import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/base.css";
import "./styles/ar.css";
import "./styles/sheets.css";

// 舊版曾快取約 18 MB 的 AI 模型；已移除物件辨識，清掉殘留快取釋放空間
if ("caches" in window) {
  void caches.delete("bazigfunar-models-v1");
}

// 註冊 PWA Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    import("./pwa/registerSW").then(({ registerSWWithUpdatePrompt }) => registerSWWithUpdatePrompt());
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
