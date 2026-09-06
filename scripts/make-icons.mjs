// One-off: generate public/logo-192.png from public/logo.webp for the PWA
// manifest and apple-touch-icon. Run: npm i -D sharp && node scripts/make-icons.mjs
// sharp is NOT a runtime dependency; delete it from devDependencies afterwards
// if you do not want to keep it (the PNG is committed).
import sharp from 'sharp';

await sharp('public/logo.webp').resize(192, 192).png().toFile('public/logo-192.png');
console.log('wrote public/logo-192.png');
