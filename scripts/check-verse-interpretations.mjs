// Coverage and integrity check for the pre-written verse interpretations.
//
// Run: node scripts/check-verse-interpretations.mjs
//
// Reports the full coverage matrix per language and exits non-zero when any
// verse/question pair is missing, empty, or too short to be real prose. Kept as
// a plain node script (mirroring generate-sitemap.mjs) so it runs without the
// TypeScript build, reading both the deck and the question list by regex.
//
// Wired into `prebuild` so a deploy cannot ship a library page with an empty
// interpretations block.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Deck slugs, in deck order. The refs are the first field of every entry.
const deckSrc = readFileSync(resolve(ROOT, 'src/lib/scripture.ts'), 'utf-8');
const deckBlock = deckSrc.slice(deckSrc.indexOf('export const BIBLE_VERSES'));
const slugOf = (ref) => ref.toLowerCase().replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
const verseSlugs = [...deckBlock.matchAll(/en:\s*\{\s*ref:\s*'([^']+)'/g)].map((m) => slugOf(m[1]));

// Question slugs from verseQuestions.ts.
const questionsSrc = readFileSync(resolve(ROOT, 'src/lib/verseQuestions.ts'), 'utf-8');
const questionSlugs = [...questionsSrc.matchAll(/slug:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);

if (!verseSlugs.length) throw new Error('no verse slugs found in src/lib/scripture.ts');
if (!questionSlugs.length) throw new Error('no question slugs found in src/lib/verseQuestions.ts');

const LANGS = ['en', 'zh'];
// Floor lengths scale with language; anything shorter is a stub, not a reflection.
const MIN_TEXT = { en: 350, zh: 120 };
const MIN_CARRY = { en: 8, zh: 6 };

// A doubled word ('need need') is the one class of literal typo that survived a
// full generation run unnoticed; it is cheap to catch and embarrassing to ship.
function findDoubledWord(text) {
  const m = text.match(/\b([A-Za-z]{3,})\s+\1\b/i);
  return m ? m[0] : null;
}

// Same-page collisions. A verse page renders all four questions at once, so an
// identical opening sentence or carry line there is visible to the reader as a
// batch artifact — unlike a repeat across two different pages, which is not.
const firstSentence = (text) => text.split(/(?<=[.?!])\s+/)[0]?.trim() ?? '';

const problems = [];
let totalPairs = 0;
let filledPairs = 0;

for (const lang of LANGS) {
  const data = JSON.parse(readFileSync(resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`), 'utf-8'));
  let filled = 0;
  for (const slug of verseSlugs) {
    for (const question of questionSlugs) {
      totalPairs++;
      const entry = data[slug]?.[question];
      if (!entry) {
        problems.push(`${lang} ${slug} ${question}: missing`);
        continue;
      }
      const text = (entry.text ?? '').trim();
      const carry = (entry.carry ?? '').trim();
      if (text.length < MIN_TEXT[lang]) {
        problems.push(`${lang} ${slug} ${question}: text too short (${text.length} < ${MIN_TEXT[lang]})`);
        continue;
      }
      if (carry.length < MIN_CARRY[lang]) {
        problems.push(`${lang} ${slug} ${question}: carry too short (${carry.length})`);
        continue;
      }
      const doubled = findDoubledWord(text);
      if (doubled) problems.push(`${lang} ${slug} ${question}: doubled word "${doubled}"`);
      filled++;
      filledPairs++;
    }

    // Same-page collisions, per verse.
    for (const slug of verseSlugs) {
      const byQuestion = data[slug];
      if (!byQuestion) continue;
      const openings = new Map();
      const carries = new Map();
      for (const question of questionSlugs) {
        const entry = byQuestion[question];
        if (!entry) continue;
        const opening = firstSentence((entry.text ?? '').trim());
        if (openings.has(opening)) {
          problems.push(`${lang} ${slug}: identical opening sentence (${question} vs ${openings.get(opening)})`);
        } else {
          openings.set(opening, question);
        }
        const carry = (entry.carry ?? '').trim();
        if (carries.has(carry)) {
          problems.push(`${lang} ${slug}: identical carry line (${question} vs ${carries.get(carry)})`);
        } else {
          carries.set(carry, question);
        }
      }
    }
  }
  console.log(`  ${lang}: ${filled}/${verseSlugs.length * questionSlugs.length} (${verseSlugs.length} verses × ${questionSlugs.length} questions)`);

  // Stray keys mean a verse was renamed or a slug typo'd — worth naming, not fatal.
  const known = new Set(verseSlugs);
  const stray = Object.keys(data).filter((k) => !known.has(k));
  if (stray.length) problems.push(`${lang}: unknown verse slugs: ${stray.join(', ')}`);
}

console.log(`\ncoverage: ${filledPairs}/${totalPairs} pairs`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  process.exit(1);
}

console.log('✓ all verse/question interpretations present');
