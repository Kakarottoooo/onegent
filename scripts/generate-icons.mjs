#!/usr/bin/env node
/**
 * Generates minimal valid PNG icons for PWA manifest.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Icon design: deep navy background with cream ring + horizon mark.
 * The mark is rendered with pixel math to avoid needing a font renderer.
 */

import { deflateSync } from "zlib";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dir, "..", "public");

// ─── CRC32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crc = crc32(Buffer.concat([t, d]));
  return Buffer.concat([u32(d.length), t, d, u32(crc)]);
}

// ─── PNG builder ────────────────────────────────────────────────────────────

/**
 * Creates a PNG file for a square image described by `pixels`,
 * where each pixel is [r, g, b].
 */
function buildPNG(pixels, size) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.concat([
    u32(size), // width
    u32(size), // height
    Buffer.from([8, 2, 0, 0, 0]), // 8-bit RGB, no filter, no interlace
  ]);

  // Raw image data: filter byte 0 (None) + RGB for each row
  const raw = Buffer.allocUnsafe(size * (1 + size * 3));
  let pos = 0;
  for (let y = 0; y < size; y++) {
    raw[pos++] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels[y * size + x];
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
    }
  }

  const idat = deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Icon pixel drawing ─────────────────────────────────────────────────────

/**
 * Returns an array of [r,g,b] pixels for a square icon:
 * - Deep navy background
 * - Cream Onegent ring + horizon mark
 */
function drawIcon(size) {
  const NAVY_1 = [0x0a, 0x0e, 0x1a];
  const NAVY_2 = [0x1a, 0x22, 0x38];
  const CREAM = [0xf5, 0xe6, 0xc8];

  const pixels = [];
  const center = (size - 1) / 2;
  const outerRadius = size * 0.315;
  const innerRadius = size * 0.275;
  const lineHeight = Math.max(8, Math.round(size * 0.039));
  const lineTop = center - lineHeight / 2;
  const lineLeft = size * 0.11;
  const lineRight = size * 0.89;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1));
      const bg = NAVY_1.map((v, i) => Math.round(v + (NAVY_2[i] - v) * t));
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inRing = dist >= innerRadius && dist <= outerRadius;
      const inHorizon =
        x >= lineLeft && x <= lineRight && y >= lineTop && y <= lineTop + lineHeight;

      pixels.push(inRing || inHorizon ? [...CREAM] : bg);
    }
  }

  return pixels;
}

// ─── Generate and write ─────────────────────────────────────────────────────

for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png = buildPNG(pixels, size);
  const outPath = join(publicDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ Wrote ${outPath} (${png.length} bytes)`);
}
