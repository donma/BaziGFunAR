/**
 * 產生 PWA 安裝圖示（純 Node，無外部依賴）。
 * 基底設計沿用原版 BaziGFun 的八卦羅盤圖示（同一設計語言），中央加 AR 光框意象。
 * 輸出 public/icon-192.png、icon-512.png、icon-maskable-512.png
 * 執行：node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public");
mkdirSync(OUT, { recursive: true });

// ---------- 極簡 PNG 編碼 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = n & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// ---------- 圖案繪製 ----------
const CREAM = [246, 241, 231];
const GOLD = [176, 141, 79];
const LINE = [201, 185, 143];
const GOOD = [122, 154, 109];
const BAD = [181, 106, 92];
const INK = [61, 52, 35];
const DARK = [22, 17, 10];

const lerp = (a, b, t) => a + (b - a) * t;
function blend(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function render(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const unit = size / (maskable ? 512 : 480);
  const safe = maskable ? 0.78 : 0.92; // maskable 保留安全區

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      let color = DARK;

      // 背景環（AR 版改為深色底）
      const outer = size * 0.47 * safe;
      if (r <= outer) {
        // 八卦扇區底色（柔綠吉 / 柔紅凶交替）
        const sector = Math.floor(((deg + 22.5) % 360) / 45);
        const base = sector % 2 === 0 ? GOOD : BAD;
        if (r < outer * 0.88 && r > outer * 0.42) {
          color = blend(DARK, base, 0.34);
        } else {
          color = DARK;
        }
        // 外圈／內圈線
        const ring = (radius, width, c) => {
          if (Math.abs(r - radius) <= width) color = c;
        };
        ring(outer, size * 0.006, GOLD);
        ring(outer * 0.88, size * 0.0035, LINE);
        ring(outer * 0.42, size * 0.0035, LINE);

        // 中央太極
        const tai = outer * 0.23;
        if (r <= tai) {
          const top = Math.hypot(dx, dy + tai / 2) <= tai / 2;
          const bottom = Math.hypot(dx, dy - tai / 2) <= tai / 2;
          let dark = dy < 0;
          if (top) dark = false;
          if (bottom) dark = true;
          color = dark ? INK : CREAM;
          if (Math.hypot(dx, dy + tai / 2) <= tai / 8) color = CREAM;
          if (Math.hypot(dx, dy - tai / 2) <= tai / 8) color = INK;
        } else if (r <= tai + size * 0.004) {
          color = CREAM;
        }

        // 八方金線
        const barR = outer * 0.66;
        if (Math.abs(r - barR) < size * 0.012 && Math.abs(((deg % 45) + 45) % 45 - 22.5) < 3) {
          color = GOLD;
        }
      } else {
        color = DARK;
      }

      // AR 光框意象：四角金色 L 形框角（外圈之外）
      const corner = size * 0.40 * safe;
      const arm = size * 0.09;
      const w = size * 0.011;
      const ax = Math.abs(dx) > Math.abs(dy) ? Math.abs(dy) : Math.abs(dx);
      const inX = Math.abs(Math.abs(dx) - corner) <= w && Math.abs(dy) <= arm;
      const inY = Math.abs(Math.abs(dy) - corner) <= w && Math.abs(dx) <= arm;
      if (r > outer && (inX || inY)) color = GOLD;

      const i = (y * size + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

writePNG(join(OUT, "icon-192.png"), 192, 192, render(192));
writePNG(join(OUT, "icon-512.png"), 512, 512, render(512));
writePNG(join(OUT, "icon-maskable-512.png"), 512, 512, render(512, true));
console.log("icons generated");
