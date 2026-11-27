/**
 * 裁切楷體字型：只保留盤面實際用到的中文字（從原始碼自動收集），輸出 woff2 內嵌進 App，
 * 離線可用、約百 KB。來源字型：霞鶩文楷 TC（LXGW WenKai TC，SIL OFL 1.1）。
 *
 * 使用：先下載 LXGWWenKaiTC-Medium.ttf，再執行
 *   KAI_TTF=<ttf 路徑> node scripts/subset-kai.mjs
 */
import subsetFont from "subset-font";
import { readFileSync, writeFileSync } from "node:fs";

const ttf = process.env.KAI_TTF ?? process.argv[2];
if (!ttf) {
  console.error("請設定 KAI_TTF 或傳入 ttf 路徑");
  process.exit(2);
}

// 這些檔案裡出現的中文字都可能被畫到盤面上
const sources = [
  "src/app/starText.ts",
  "src/domain/bazhai/bazhai.ts",
  "src/domain/bazhai/mingGua.ts",
  "src/vr/rings.ts",
  "src/vr/render.ts",
];
const set = new Set("吉凶北東南西方");
for (const f of sources) {
  for (const ch of readFileSync(f, "utf8")) if (/[\u3400-\u9fff]/.test(ch)) set.add(ch);
}
const text = [...set].join("");

const out = await subsetFont(readFileSync(ttf), text, { targetFormat: "woff2" });
writeFileSync("src/assets/fonts/bz-kai.woff2", out);
console.log(`glyphs: ${set.size}, bytes: ${out.length}`);
