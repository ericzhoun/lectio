// Generate public/sitemap.xml from card data in src/lib/deckData.ts.
// Runs as a prebuild step so the sitemap is always up-to-date.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SITE = 'https://dramatherapy.us';
const STATIC_PATHS = ['/', '/pricing', '/library', '/approach', '/signup', '/privacy'];

// Extract English card names from deckData.ts (the `deck` export).
const deckSrc = readFileSync(resolve(ROOT, 'src/lib/deckData.ts'), 'utf-8');
const deckBlock = deckSrc.slice(deckSrc.indexOf('export const deck'));
const cardNames = [...deckBlock.matchAll(/"en":\s*"([^"]+)"/g)].map((m) => m[1]);

// Mirror the slug logic from src/lib/tarot.ts → cardSlug()
function cardSlug(name) {
  return name.toLowerCase().replace(/ /g, '_').replace(/'/g, '').replace(/-/g, '_');
}

function urlEntry(path, changefreq, priority) {
  const alts = ['en', 'zh']
    .map(
      (lang) =>
        `      <xhtml:link rel="alternate" hreflang="${lang}" href="${SITE}${path}?lang=${lang}" />`
    )
    .join('\n');
  return `  <url>
    <loc>${SITE}${path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${alts}
  </url>`;
}

const today = new Date().toISOString().slice(0, 10);

const staticUrls = STATIC_PATHS.map((p) =>
  urlEntry(p, p === '/' ? 'daily' : 'weekly', p === '/' ? '1.0' : '0.8')
);

const cardUrls = cardNames.map((name) => {
  const path = `/library/${cardSlug(name)}`;
  return `  <url>
    <loc>${SITE}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${path}?lang=en" />
    <xhtml:link rel="alternate" hreflang="zh" href="${SITE}${path}?lang=zh" />
  </url>`;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticUrls.join('\n')}
${cardUrls.join('\n')}
</urlset>
`;

const outPath = resolve(ROOT, 'public/sitemap.xml');
writeFileSync(outPath, xml, 'utf-8');
console.log(`✓ sitemap.xml generated → ${outPath} (${staticUrls.length + cardUrls.length} URLs)`);
