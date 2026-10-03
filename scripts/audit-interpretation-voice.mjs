// Measure the stylistic monotony the independent review quantified, so the
// repair is aimed at data rather than at an impression.
//
// Run: node scripts/audit-interpretation-voice.mjs [--verbose]
//
// Reports, per language:
//   - sentence-count distribution
//   - how many reflections end in a question, and the opening word of it
//   - repeated opening bigrams / trigrams across the corpus
//   - pages where two or more of the four answers share their opening trigram
//     (the "77 pages" the review flagged)
//   - repeated closing-question shapes (e.g. every entry ending "What would…")
//
// Read-only. Existing content is not modified.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

const deckSrc = readFileSync(resolve(ROOT, 'src/lib/scripture.ts'), 'utf-8');
const deckBlock = deckSrc.slice(deckSrc.indexOf('export const BIBLE_VERSES'));
const slugOf = (ref) => ref.toLowerCase().replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
const verseSlugs = [...deckBlock.matchAll(/en:\s*\{\s*ref:\s*'([^']+)'/g)].map((m) => slugOf(m[1]));

const questionsSrc = readFileSync(resolve(ROOT, 'src/lib/verseQuestions.ts'), 'utf-8');
const questionSlugs = [...questionsSrc.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);

const LANGS = ['en', 'zh'];
const data = Object.fromEntries(
  LANGS.map((lang) => [lang, JSON.parse(readFileSync(resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`), 'utf-8'))])
);

// ---- helpers ---------------------------------------------------------------

const sentences = (text) =>
  text
    .trim()
    // English splits on '. '; Chinese needs '。' as a boundary too, since it is
    // written without spaces.
    .split(/(?<=[.?!])\s+|(?<=[\u3002\uff01\uff1f])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/**
 * The words a reflection opens with, lowercased. Chinese has no word spaces,
 * so it is measured in characters — taking the first 2 Latin words from a
 * Chinese string would return the whole sentence and make every cell unique.
 */
const opening = (text, n) => {
  const clean = text.replace(/^[\s"'\u201c\u2018([\u300c\u300e]+/, '').trim();
  if (/^[\u4e00-\u9fa5]/.test(clean)) {
    // Strip punctuation first so '，' does not become an "opening character".
    return clean.replace(/[\s\u3000]/g, '').slice(0, n);
  }
  return clean
    .split(/\s+/)
    .slice(0, n)
    .join(' ')
    .replace(/[^A-Za-z' ]/g, '')
    .toLowerCase();
};

/** Opening length in characters/words, i.e. how many n-grams to compare. */
const openingN = (lang) => (lang === 'zh' ? 4 : 2);

const lastQuestion = (text) => {
  const parts = sentences(text);
  const last = parts[parts.length - 1] ?? '';
  return /[?\uff1f]\s*$/.test(text.trim()) ? last : null;
};

const counts = (arr) => {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;

// ---- per-language analysis -------------------------------------------------

const flaggedPages = [];
const allTrigrams = [];

for (const lang of LANGS) {
  const byVerse = data[lang];
  const texts = [];
  for (const slug of verseSlugs) {
    for (const q of questionSlugs) {
      const t = byVerse[slug]?.[q]?.text;
      if (t) texts.push({ slug, q, text: t.trim() });
    }
  }
  console.log(`\n${'='.repeat(64)}\n${lang.toUpperCase()} — ${texts.length} reflections\n${'='.repeat(64)}`);

  // Sentence counts.
  const sc = counts(texts.map((t) => sentences(t.text).length));
  console.log('\nsentences per reflection:', sc.slice(0, 8).map(([n, c]) => `${n}:${c}`).join('  '));

  // Ending in a question, and the question's opening word.
  const qEnding = texts.filter((t) => /[?？]\s*$/.test(t.text));
  console.log(`ends in a question: ${qEnding.length}/${texts.length} (${pct(qEnding.length, texts.length)})`);
  const openers = counts(
    qEnding.map((t) => {
      const q = lastQuestion(t.text) ?? '';
      const clean = q.replace(/^[\s"'\u201c\u2018([\u300c\u300e]+/, '');
      return lang === 'zh' ? clean.slice(0, 2) : clean.split(/\s+/)[0]?.toLowerCase() ?? '';
    })
  );
  console.log('  closing-question first word:', openers.slice(0, 8).map(([w, c]) => `${w}:${c}`).join('  '));

  // Opening n-grams.
  const N = openingN(lang);
  const bigrams = counts(texts.map((t) => opening(t.text, N)));
  const trigrams = counts(texts.map((t) => opening(t.text, N + 1)));
  const triCovered = trigrams.filter(([, c]) => c >= 2);
  console.log(`\n  repeated opening ${N}-grams (>=4):`, bigrams.filter(([, c]) => c >= 4).slice(0, 8).map(([w, c]) => `"${w}":${c}`).join('  '));
  console.log(`  repeated opening ${N + 1}-grams: ${triCovered.length} groups covering ${triCovered.reduce((s, [, c]) => s + c, 0)}/${texts.length} (${pct(triCovered.reduce((s, [, c]) => s + c, 0), texts.length)})`);
  console.log('  worst:', triCovered.slice(0, 6).map(([w, c]) => `"${w}":${c}`).join('  '));
  allTrigrams.push({ lang, trigrams });

  // Pages sharing an opening n-gram across their own answers.
  let pages = 0;
  let cells = 0;
  const pageDetail = [];
  for (const slug of verseSlugs) {
    const seen = new Map();
    const hits = [];
    for (const q of questionSlugs) {
      const t = byVerse[slug]?.[q]?.text;
      if (!t) continue;
      const tri = opening(t, N);
      if (seen.has(tri)) {
        hits.push({ q, tri, clash: seen.get(tri) });
        cells++;
      } else {
        seen.set(tri, q);
      }
    }
    if (hits.length) {
      pages++;
      pageDetail.push({ slug, hits });
    }
  }
  flaggedPages.push({ lang, pages, cells, pageDetail });
  console.log(`\n  pages sharing an opening trigram across their own answers: ${pages}/${verseSlugs.length} (${cells} cells)`);
  if (VERBOSE) for (const p of pageDetail) console.log(`    ${p.slug}: ${p.hits.map((h) => `${h.q}~${h.clash} "${h.tri}"`).join('; ')}`);

  // Identical closing questions (not just the same first word).
  const closers = counts(qEnding.map((t) => (lastQuestion(t.text) ?? '').toLowerCase().trim()));
  const repeatedClosers = closers.filter(([, c]) => c >= 2);
  console.log(`  identical closing questions: ${repeatedClosers.length} groups covering ${repeatedClosers.reduce((s, [, c]) => s + c, 0)} cells`);
  if (VERBOSE) for (const [q, c] of repeatedClosers.slice(0, 10)) console.log(`    ${c}x  ${q}`);
}

// ---- work list -------------------------------------------------------------
// One cell per page is enough to break a shared opening: the later cell in
// question order is rewritten, which removes the collision without touching
// three good reflections to fix one.

const workList = [];
for (const { lang, pageDetail } of flaggedPages) {
  for (const page of pageDetail) {
    for (const hit of page.hits) {
      workList.push({ lang, slug: page.slug, question: hit.q, clashWith: hit.clash, trigram: hit.tri });
    }
  }
}

console.log(`\n${'='.repeat(64)}\nWORK LIST: ${workList.length} cell(s)\n${'='.repeat(64)}`);
const byLang = { en: 0, zh: 0 };
for (const w of workList) byLang[w.lang]++;
console.log(`  en: ${byLang.en}   zh: ${byLang.zh}`);
if (VERBOSE) for (const w of workList) console.log(`  ${w.lang} ${w.slug}/${w.question} (opens like ${w.clashWith}: "${w.trigram}")`);

// Write the list for the repair step to consume.
const out = resolve(ROOT, 'scripts/data/interpretation-voice-worklist.json');
const { writeFileSync } = await import('node:fs');
writeFileSync(out, `${JSON.stringify(workList, null, 2)}\n`, 'utf-8');
console.log(`\nwrote ${out}`);
