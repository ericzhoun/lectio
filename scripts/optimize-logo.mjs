// Convert public/logo.png -> public/logo.webp, tuning quality to land near ~40 KB.
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'public/logo.png';
const OUT = 'public/logo.webp';
const TARGET = 40 * 1024; // ~40 KB

let best = null;
for (let q = 82; q >= 40; q -= 4) {
  const buf = await sharp(SRC).webp({ quality: q, effort: 6 }).toBuffer();
  console.log(`quality ${q}: ${(buf.length / 1024).toFixed(1)} KB`);
  if (buf.length <= TARGET) {
    best = { q, buf };
    break;
  }
  best = { q, buf }; // keep the smallest so far as fallback
}
if (!best) {
  best = { q: 40, buf: await sharp(SRC).webp({ quality: 40 }).toBuffer() };
}
fs.writeFileSync(OUT, best.buf);
const meta = await sharp(OUT).metadata();
console.log(
  `wrote ${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, ` +
  `${meta.width}x${meta.height}, quality ${best.q}`
);
