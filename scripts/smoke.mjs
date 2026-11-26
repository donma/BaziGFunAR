/**
 * 桌面瀏覽器煙霧測試（真 Chrome/Edge）：
 * 引導 → 建立人物 → 進入 AR → 等待相機與模型 → 按快門 → 驗證雙照片紀錄 → 截圖。
 * 需先 npm run build && npm run preview（或 npm run dev），再 node scripts/smoke.mjs。
 * 預設網址：http://localhost:4173/BaziGFunAR/；可用 SMOKE_URL 覆寫。
 *
 * 此測試驗證「程式是否正常渲染與運作」；手機感測器／物件辨識的正確性仍需實機（見 docs/acceptance.md）。
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.SMOKE_URL ?? "http://localhost:4173/BaziGFunAR/";
const OUT = "scripts/.cache";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
  ],
});

const errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  permissions: ["camera", "accelerometer", "gyroscope", "magnetometer"],
});
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

const report = { url: URL, errors: [] };

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // 首次引導：填寫人物（1991 女＝乾六命）
  await page.locator('.onboarding input[placeholder="例：媽媽"]').fill("測試小明");
  await page.locator('.onboarding input[type="date"]').fill("1991-06-15");
  await page.locator('.onboarding select').selectOption("female");
  await page.getByRole("button", { name: /建立人物/ }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "進入 AR" }).click();

  await page.locator(".scene").waitFor();

  // 假相機偶發結束：統一的恢復流程（AR 停止畫面「重試相機」／狀態列相機膠囊，同真機中斷處理路徑）
  const ensureCam = async () => {
    for (let i = 0; i < 8; i++) {
      if (await page.locator(".ar-stopped").count()) {
        const retry = page.locator(".ar-stop-card button").first();
        if (await retry.count()) await retry.click();
      } else {
        const chip = page.locator(".status-chips .chip-btn").filter({ hasText: /相機/ });
        const text = (await chip.count()) ? await chip.first().textContent() : "";
        if (text?.includes("相機✓")) return;
        if (text) await chip.first().click();
      }
      await page.waitForTimeout(1200);
    }
    throw new Error("相機無法恢復");
  };
  await ensureCam();
  await page.waitForFunction(() => [...document.querySelectorAll(".status-chips .chip")].some((c) => c.textContent?.includes("AI 就緒")), null, { timeout: 120000 });
  await ensureCam();
  await page.waitForTimeout(500);

  // 模擬方向感測：alpha=45、直立 → 鏡頭朝西北 315°；乾六命（1991 女）西北＝伏位
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 45, beta: 90, gamma: 0, absolute: true }));
    }
  });
  await page.waitForTimeout(800);
  report.headingAfter = await page.locator(".heading-deg").textContent();
  report.hudStar = await page.locator(".heading-star").textContent().catch(() => null);
  report.floatSticker = await page.locator(".ar-float, .ar-sticker").count();
  await page.screenshot({ path: `${OUT}/ar-heading.png` });

  report.scene = await page.locator(".scene").count();
  report.chips = await page.locator(".status-chips .chip").allTextContents();
  report.heading = await page.locator(".heading-deg").textContent();
  report.shutter = await page.locator(".shutter").count();
  report.stopped = await page.locator(".ar-stopped").count();
  await page.screenshot({ path: `${OUT}/ar-main.png` });

  // 按快門：一次產生原始＋AR 照片，同一筆紀錄
  await page.locator(".shutter").click();
  await page.waitForTimeout(1500);
  report.toast = await page.locator(".toast").textContent().catch(() => null);

  const db = await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => {
      const r = indexedDB.open("bazigfunar", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const d = await open();
    const all = (store) => new Promise((resolve, reject) => {
      const r = d.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const records = await all("records");
    const photos = await all("photos");
    return {
      records: records.length,
      photos: photos.length,
      kinds: photos.map((p) => p.kind).sort(),
      schema: records[0]?.schemaVersion,
      sameRecord: !!records[0],
    };
  });
  report.db = db;

  // PWA 快取檢查
  report.cacheKeys = await page.evaluate(() => caches.keys());
  report.sw = await page.evaluate(() => !!navigator.serviceWorker.controller);

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));

  if (report.scene !== 1 || report.shutter !== 1 || db.records < 1 || db.photos < 2 || errors.length > 0 ||
      !report.headingAfter?.includes("315") || report.hudStar !== "伏位") {
    process.exitCode = 1;
  }
} catch (e) {
  console.error("SMOKE FAIL:", e);
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  await page.screenshot({ path: `${OUT}/ar-fail.png` }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
