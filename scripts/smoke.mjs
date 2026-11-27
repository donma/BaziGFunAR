/**
 * 桌面瀏覽器煙霧測試（真 Chrome/Edge，假相機＋模擬方向感測）：
 * 引導 → 建立人物 → 進入 AR → 模擬鏡頭朝西北（平視／低頭）→ 盤面有繪製 → 點扇區開資訊卡
 * → 按快門 → 驗證雙照片紀錄 → 截圖。
 * 需先 npm run build && npm run preview（或 npm run dev），再 node scripts/smoke.mjs。
 * 預設網址：http://localhost:4173/BaziGFunAR/；可用 SMOKE_URL 覆寫。
 *
 * 此測試驗證「程式是否正常渲染與運作」；真實手機磁力計與透視手感仍需實機（見 docs/acceptance.md）。
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fakeCameraFile } from "./lib/test-browser.mjs";

const URL = process.env.SMOKE_URL ?? "http://localhost:4173/BaziGFunAR/";
const OUT = "scripts/.cache";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    // 以影片檔當假相機：不會像內建測試圖那樣自行結束串流，畫面也像真實房間
    `--use-file-for-fake-video-capture=${fakeCameraFile()}`,
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

/** 持續送出方向事件（模擬手機感測器的 60Hz 串流），讓濾波與平滑收斂 */
const pose = async (alpha, beta, gamma = 0, ms = 1200) => {
  await page.evaluate(
    ({ alpha, beta, gamma, ms }) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha, beta, gamma, absolute: true }));
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      }),
    { alpha, beta, gamma, ms },
  );
};

/** 畫布上有多少像素被繪製（證明盤面真的畫出來） */
const paintedPixels = () =>
  page.evaluate(() => {
    const c = document.querySelector(".vr-canvas");
    if (!c) return -1;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 16) if (d[i] > 8) n++;
    return n;
  });

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

  // 僅供目視評估：以類似室內的米牆＋木地板取代鮮綠的假相機畫面（SMOKE_BACKDROP=room）
  if (process.env.SMOKE_BACKDROP === "room") {
    await page.addStyleTag({
      content: `.scene-video{opacity:0 !important}
      .scene-media{background:linear-gradient(to bottom,#cdbf9f 0%,#b4a283 48%,#8a6f4e 52%,#5a3f27 100%) !important}`,
    });
  }

  // 假相機偶發結束：統一的恢復流程（同真機中斷處理路徑）
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

  // 低頭看地板：朝西北（alpha=45）、低頭約 40°（beta=50）
  await pose(45, 50, 0, 2400);
  await ensureCam();
  report.headingDown = await page.locator(".heading-deg").textContent();
  report.paintedDown = await paintedPixels();
  await page.screenshot({ path: `${OUT}/vr-down.png` });

  // 平視：地平線光柱與下緣盤面
  await pose(45, 88, 0, 1200);
  report.headingLevel = await page.locator(".heading-deg").textContent();
  report.paintedLevel = await paintedPixels();
  await page.screenshot({ path: `${OUT}/vr-level.png` });

  // 幾乎垂直往下看：圓心的大八卦
  await pose(45, 14, 0, 1500);
  await ensureCam();
  report.centerPainted = await paintedPixels();
  await page.screenshot({ path: `${OUT}/vr-center.png` });

  // 中等俯角（約 60°）：檢查大八卦的透視
  await pose(45, 30, 0, 1200);
  await ensureCam();
  await page.screenshot({ path: `${OUT}/vr-mid.png` });

  // 轉向東南（alpha=225 → 朝 135°）低頭，換另一個扇區
  await pose(225, 55, 0, 1400);
  report.headingTurn = await page.locator(".heading-deg").textContent();
  await page.screenshot({ path: `${OUT}/vr-turn.png` });

  // 點畫面中央（面向的扇區）→ 底部資訊卡
  await page.mouse.click(195, 520);
  await page.waitForTimeout(500);
  report.sheetTitle = await page.locator(".sheet-title").textContent().catch(() => null);
  await page.screenshot({ path: `${OUT}/vr-sheet.png` });
  if (await page.locator(".sheet").count()) await page.getByRole("button", { name: "關閉" }).click();
  await page.waitForTimeout(300);

  report.chips = await page.locator(".status-chips .chip").allTextContents();
  report.shutter = await page.locator(".shutter").count();
  report.stopped = await page.locator(".ar-stopped").count();

  // 按快門：一次產生原始＋AR 照片，同一筆紀錄
  await pose(45, 50, 0, 800);
  for (let i = 0; i < 4; i++) {
    await ensureCam();
    if (await page.locator(".shutter").isEnabled()) break;
  }
  await page.locator(".shutter").click();
  await page.waitForTimeout(1800);
  report.toast = await page.locator(".toast").textContent().catch(() => null);

  report.db = await page.evaluate(async () => {
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
      state: records[0]?.detectionState,
    };
  });

  report.sw = await page.evaluate(() => !!navigator.serviceWorker.controller);

  // 取出 AR 合成照存成檔案，目視確認照片中的盤面
  const arB64 = await page.evaluate(async () => {
    const d = await new Promise((resolve, reject) => {
      const r = indexedDB.open("bazigfunar", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const photos = await new Promise((resolve, reject) => {
      const r = d.transaction("photos", "readonly").objectStore("photos").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const ar = photos.find((p) => p.kind === "ar");
    if (!ar) return null;
    const bytes = new Uint8Array(await ar.blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  if (arB64) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${OUT}/photo-ar.jpg`, Buffer.from(arB64, "base64"));
  }
  report.cacheKeys = await page.evaluate(() => caches.keys());
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));

  const ok =
    report.paintedDown > 200 &&
    report.paintedLevel > 20 &&
    report.headingDown?.includes("315") &&
    report.sheetTitle &&
    report.db.records >= 1 &&
    report.db.photos >= 2 &&
    errors.length === 0;
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("SMOKE FAIL:", e);
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  await page.screenshot({ path: `${OUT}/ar-fail.png` }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
