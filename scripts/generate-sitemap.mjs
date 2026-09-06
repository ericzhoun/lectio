// Generate public/sitemap.xml from verse data in src/lib/scripture.ts.
// Runs as a prebuild step so the sitemap is always up-to-date.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SITE = 'https://3livescapture.com';
const STATIC_PATHS = ['/', '/today', '/pricing', '/library', '/approach', '/signup', '/privacy'];

// Extract English verse references from scripture.ts (the BIBLE_VERSES export).
const deckSrc = readFileSync(resolve(ROOT, 'src/lib/scripture.ts'), 'utf-8');
const deckBlock = deckSrc.slice(deckSrc.indexOf('export const BIBLE_VERSES'));
const verseRefs = [...deckBlock.matchAll(/en:\s*\{\s*ref:\s*'([^']+)'/g)].map((m) => m[1]);

// Mirror the slug logic from src/lib/scripture.ts -> verseSlug()
function verseSlug(refEn) {
  return refEn.toLowerCase().replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
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

const verseUrls = verseRefs.map((ref) => {
  const path = `/library/${verseSlug(ref)}`;
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
${verseUrls.join('\n')}
</urlset>
`;

const outPath = resolve(ROOT, 'public/sitemap.xml');
writeFileSync(outPath, xml, 'utf-8');
console.log(`✓ sitemap.xml generated → ${outPath} (${staticUrls.length + verseUrls.length} URLs)`);
