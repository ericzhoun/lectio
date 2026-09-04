// Convert public/logo.png -> public/logo.webp, square-cropped and sized for the
// 96px `.site-logo` slot (512px covers 3x displays with room to spare).
import sharp from 'sharp';
import fs from 'node:fs';
import { squareLogo } from './logo-source.mjs';

const OUT = 'public/logo.webp';
const SIDE = 512;
const TARGET = 40 * 1024; // ~40 KB

const png = await sharp(await squareLogo()).resize(SIDE, SIDE).png().toBuffer();

let best = null;
for (let q = 86; q >= 40; q -= 4) {
  const buf = await sharp(png).webp({ quality: q, effort: 6 }).toBuffer();
  console.log(`quality ${q}: ${(buf.length / 1024).toFixed(1)} KB`);
  best = { q, buf };
  if (buf.length <= TARGET) break;
}

fs.writeFileSync(OUT, best.buf);
const meta = await sharp(OUT).metadata();
console.log(
  `wrote ${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, ` +
  `${meta.width}x${meta.height}, quality ${best.q}`
);
