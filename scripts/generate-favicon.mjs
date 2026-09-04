// Generate public/favicon.ico from public/logo.png.
//
// The .ico container holds PNG-encoded entries at 16/32/48/64 px (PNG-in-ICO is
// supported by every browser we target). Run after replacing the logo:
//   node scripts/generate-favicon.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import { squareLogo } from './logo-source.mjs';

const OUT = 'public/favicon.ico';
const SIZES = [16, 32, 48, 64];

// One square render up front; each icon size is a resize of that.
const square = await squareLogo();

const images = await Promise.all(
  SIZES.map(async (size) => ({
    size,
    png: await sharp(square).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
  }))
);

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

const header = Buffer.alloc(HEADER_BYTES);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(images.length, 4);

let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
const entries = images.map(({ size, png }) => {
  const entry = Buffer.alloc(ENTRY_BYTES);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette colors
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});

fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
console.log(
  `wrote ${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, ` +
    `sizes ${SIZES.join('/')}`
);
