// Generate public/og-image.png (1200x630) for social/AI preview cards.
// Runs as a prebuild step so the image always matches the current logo.
import sharp from 'sharp';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const W = 1200;
const H = 630;

const logo = await sharp(resolve(ROOT, 'public/logo.png'))
  .resize({ height: 340 })
  .png()
  .toBuffer();
const logoMeta = await sharp(logo).metadata();
const left = Math.round((W - logoMeta.width) / 2);

const svg = Buffer.from(
  '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<text x="600" y="524" text-anchor="middle" font-family="Cormorant Garamond, Georgia, \'Times New Roman\', serif" font-size="96" fill="#211e18">Lectio</text>' +
    '<text x="600" y="578" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="27" letter-spacing="2" fill="#57503f">Daily Lectio Divina \u00b7 \u5723\u8a00\u8bf5\u8bfb</text>' +
  '</svg>'
);

await sharp({ create: { width: W, height: H, channels: 4, background: '#f5efe2' } })
  .composite([
    { input: logo, left, top: 58 },
    { input: svg, left: 0, top: 0 },
  ])
  .png()
  .toFile(resolve(ROOT, 'public/og-image.png'));

console.log('\u2713 og-image.png generated (1200x630) \u2192 public/og-image.png');
