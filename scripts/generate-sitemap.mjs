// Generate public/sitemap.xml from verse data in src/lib/scripture.ts.
// Runs as a prebuild step so the sitemap is always up-to-date.
//
// URL policy (see src/lib/seo.ts): the bare path is the English page and
// ?lang=zh is the Chinese page. Each variant is listed as its own <url> and
// self-canonicalizes; the xhtml:link cluster must mirror the on-page hreflang
// exactly or Google gets contradictory signals.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SITE = 'https://enjoyhim.org';
// /signup is intentionally absent: the page is noindex + robots.txt-disallowed
// (auth page), and listing it in the sitemap makes Google report
// "Submitted URL blocked by robots.txt" / "Excluded by noindex" contradictions.
const STATIC_PATHS = ['/', '/pricing', '/library', '/topics', '/approach', '/about', '/privacy'];

// Extract English verse references from scripture.ts (the BIBLE_VERSES export).
const deckSrc = readFileSync(resolve(ROOT, 'src/lib/scripture.ts'), 'utf-8');
const deckBlock = deckSrc.slice(deckSrc.indexOf('export const BIBLE_VERSES'));
const verseRefs = [...deckBlock.matchAll(/en:\s*\{\s*ref:\s*'([^']+)'/g)].map((m) => m[1]);

// Topic slugs from topics.ts. Plain regex rather than an import: this script
// runs on bare node before the TypeScript build, and mirrors the established
// extraction pattern used for the deck above.
const topicsSrc = readFileSync(resolve(ROOT, 'src/lib/topics.ts'), 'utf-8');
const topicSlugs = [...topicsSrc.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);

// Mirror the slug logic from src/lib/scripture.ts -> verseSlug()
function verseSlug(refEn) {
  return refEn.toLowerCase().replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function altLinks(path) {
  return [
    ['en', `${SITE}${path}`],
    ['zh', `${SITE}${path}?lang=zh`],
    ['x-default', `${SITE}${path}`],
  ]
    .map(
      ([hreflang, href]) =>
        `      <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`
    )
    .join('\n');
}

function urlEntry(path, lang, { changefreq, priority, lastmod }) {
  const loc = lang === 'zh' ? `${SITE}${path}?lang=zh` : `${SITE}${path}`;
  return `  <url>
    <loc>${loc}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${altLinks(path)}
  </url>`;
}

const today = new Date().toISOString().slice(0, 10);

const entries = [];
for (const p of STATIC_PATHS) {
  const meta = { changefreq: p === '/' ? 'daily' : 'weekly', priority: p === '/' ? '1.0' : '0.8' };
  entries.push(urlEntry(p, 'en', meta), urlEntry(p, 'zh', meta));
}
for (const ref of verseRefs) {
  const p = `/library/${verseSlug(ref)}`;
  const meta = { changefreq: 'monthly', priority: '0.6', lastmod: today };
  entries.push(urlEntry(p, 'en', meta), urlEntry(p, 'zh', meta));
}
for (const slug of topicSlugs) {
  const p = `/topics/${slug}`;
  const meta = { changefreq: 'weekly', priority: '0.7', lastmod: today };
  entries.push(urlEntry(p, 'en', meta), urlEntry(p, 'zh', meta));
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;

const outPath = resolve(ROOT, 'public/sitemap.xml');
writeFileSync(outPath, xml, 'utf-8');
console.log(`✓ sitemap.xml generated → ${outPath} (${entries.length} URLs: ${STATIC_PATHS.length} static × 2 + ${verseRefs.length} verses × 2 + ${topicSlugs.length} topics × 2)`);
