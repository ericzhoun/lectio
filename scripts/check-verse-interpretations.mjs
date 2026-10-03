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
//
// "need need not" is NOT this typo: there the first 'need' is a noun object and
// the second begins the verb phrase ("the need need not mean..."), which is
// grammatical. Excluded explicitly so the check never fires on correct prose.
function findDoubledWord(text) {
  if (/\bneed need not\b/i.test(text)) {
    // Only a flag if the same word doubles somewhere the noun reading is absent.
    const withoutLegit = text.replace(/\bneed need not\b/gi, ' ');
    const m = withoutLegit.match(/\b([A-Za-z]{3,})\s+\1\b/i);
    return m ? m[0] : null;
  }
  const m = text.match(/\b([A-Za-z]{3,})\s+\1\b/i);
  return m ? m[0] : null;
}

// An English sentence must start capitalized. The model produced lowercase
// lead-ins before closing questions during a repair pass, which read as broken
// grammar on the page.
function findLowercaseSentenceStart(text) {
  const parts = text.trim().split(/(?<=[.?!])\s+/);
  for (let i = 1; i < parts.length; i++) {
    if (/^[a-z]/.test(parts[i])) return parts[i].slice(0, 40);
  }
  return null;
}

// ---- answering the right question -----------------------------------------
// The most damaging failure found in review was a cell whose body had been
// rewritten to answer a DIFFERENT question than the one it sits under: on
// /library/<slug> all four answers render together and a visitor arrives from a
// question-shaped search, so an off-slot entry is a visible content error.
//
// This scans the OPENING SENTENCE of each cell for the signature frame of a
// different question ("here is what to let go of", "how to be still"). It is a
// lint, not a proof: it catches drift that announces itself, and the sample it
// flags should be read. A body can discuss another theme in passing without
// being off-slot, so only the opening frame is examined.
const OFF_SLOT_FRAMES = [
  // Frames belonging to the "what should I let go of" question.
  { question: 'letting-go', pattern: /\b(what to let go of|what you should (?:let go of|release)|what to release|need to let go)\b/i },
  // Frames belonging to the "how can I find stillness" question.
  { question: 'stillness', pattern: /\b(how to (?:find|be) s?ti?ll|finding stillness|a method for stillness|how to be quiet|a less crowded day|no method for stillness)\b/i },
  // Frames belonging to the "learn to love better" question.
  { question: 'loving-better', pattern: /\b(how to love (?:better|another person|in a relationship)|learn(?:ing)? to love better)\b/i },
  // Frames belonging to the "pressure at work" question.
  { question: 'pressure-at-work', pattern: /\b(how to (?:manage|handle|face) (?:work |workplace )?pressure|manage pressure at work)\b/i },
];

function findOffSlotOpening(text, ownQuestion) {
  const first = text.trim().split(/(?<=[.?!])\s+/)[0] ?? '';
  for (const frame of OFF_SLOT_FRAMES) {
    if (frame.question === ownQuestion) continue;
    if (frame.pattern.test(first)) return `opening frames the ${frame.question} question`;
  }
  return null;
}

// One cell is one reflection ending in one question. A repair pass merged two
// or three complete reflections into single cells, and every other check let
// them through because they were long enough and ended in a question mark.
//
// Detecting this by counting question marks does not work: Chinese prose
// legitimately poses a rhetorical question mid-reflection before closing with
// its real one, and bodies quote scriptural questions. What actually marks a
// merged cell is a blank line (two paragraphs pasted together) or a length far
// beyond any single reflection — the two merged cells found in review were 336
// and 210 words, against a corpus that runs 69–130.
const MAX_CELL_CHARS = { en: 1900, zh: 1000 };

function findMergedCell(text, lang) {
  if (/\n/.test(text)) return 'contains a blank line';
  if (text.length > MAX_CELL_CHARS[lang]) {
    return `${text.length} characters (over ${MAX_CELL_CHARS[lang]})`;
  }
  return null;
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
      if (lang === 'en') {
        const lower = findLowercaseSentenceStart(text);
        if (lower) problems.push(`${lang} ${slug} ${question}: sentence starts lowercase ("${lower}…")`);
      }
      const merged = findMergedCell(text, lang);
      if (merged) problems.push(`${lang} ${slug} ${question}: merged cell (${merged})`);
      const offSlot = findOffSlotOpening(text, question);
      if (offSlot) problems.push(`${lang} ${slug} ${question}: ${offSlot}`);
      filled++;
      filledPairs++;
    }
  }

  // Same-page collisions, per verse. Kept as its own loop over verses — nesting
  // it inside the per-question loop above reported each collision once per
  // question on the page.
  for (const slug of verseSlugs) {
    const byQuestion = data[slug];
    if (!byQuestion) continue;
    const openings = new Map();
    const carries = new Map();
    const closers = new Map();
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
      // Two of the four answers on a page must not end with the same question.
      const body = (entry.text ?? '').trim();
      const parts = body.split(/(?<=[.?!])\s+|(?<=[\u3002\uff01\uff1f])/).filter((s) => s.trim());
      const closer = (parts[parts.length - 1] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (closer && closers.has(closer)) {
        problems.push(`${lang} ${slug}: identical closing question (${question} vs ${closers.get(closer)})`);
      } else if (closer) {
        closers.set(closer, question);
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
