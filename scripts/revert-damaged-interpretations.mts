// Revert the cells a review found damaged by the voice-repair pass.
//
// Run: npx tsx scripts/revert-damaged-interpretations.mts [--dry]
//
// The repair pass rewrote openings and closing questions to break up repeated
// sentence patterns across the library. Two classes of damage came out of it,
// both confirmed by reading the cells against their question slot:
//
//   1. WRONG SLOT — the rewritten reflection answers a different question than
//      the one it sits under. On /library/<slug> all four answers render
//      together and a visitor arrives from a question-shaped search, so a
//      "learning to love better" entry that talks about stillness is a real
//      content error, not a stylistic wobble.
//
//   2. MERGED — one cell ended up holding two or three complete reflections,
//      each with its own closing question.
//
// For these cells the ORIGINAL generated text is correct (it answers its own
// question), so reverting is both the lowest-risk fix and the most faithful to
// the question the page is answering. Restoring text and carry together keeps
// the pair in sync.
//
// After reverting, openings are re-checked: a revert can restore an opening
// that collided with a sibling on the same page. Any such case is reported.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLibraryVerses } from '../src/lib/scripture';
import { TYPICAL_QUESTIONS } from '../src/lib/verseQuestions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

type Lang = 'en' | 'zh';
interface Interpretation { text: string; carry: string }
type EntryMap = Record<string, Record<string, Interpretation>>;

const DECK = getLibraryVerses();
const Q_SLUGS = TYPICAL_QUESTIONS.map((q) => q.slug);
const pathFor = (lang: Lang) => resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`);
const backupFor = (lang: Lang) => resolve(ROOT, `.backup-2026-10-03/verseInterpretations.${lang}.json`);
const load = (p: string): EntryMap => JSON.parse(readFileSync(p, 'utf8'));

/** Deck order, then question order — keeps diffs readable. */
function order(entries: EntryMap): EntryMap {
  const out: EntryMap = {};
  for (const v of DECK) {
    const byQuestion = entries[v.slug];
    if (!byQuestion) continue;
    const qOrdered: Record<string, Interpretation> = {};
    for (const q of Q_SLUGS) if (byQuestion[q]) qOrdered[q] = byQuestion[q]!;
    if (Object.keys(qOrdered).length) out[v.slug] = qOrdered;
  }
  return out;
}

const opening = (text: string, lang: Lang): string => {
  const clean = text.replace(/^[\s"'“‘([「『]+/, '').trim();
  return lang === 'zh'
    ? clean.replace(/[\s\u3000]/g, '').slice(0, 4)
    : clean.split(/\s+/).slice(0, 2).join(' ').replace(/[^A-Za-z' ]/g, '').toLowerCase();
};

// ---- the damaged cells -----------------------------------------------------
// Identified by reading each against its question slot, and confirmed by
// comparing the repaired text with the original: in every case below the
// original answers its own question and the rewrite answers a neighbour's.

const REVERTS: Record<Lang, { slug: string; question: string; why: 'wrong-slot' | 'merged' }[]> = {
  en: [
    // Rewritten into the stillness question's territory.
    { slug: 'hebrews-6-19', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'hebrews-12-2', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'matthew-21-21', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'psalm-23-1', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'proverbs-3-13-18', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'psalm-119-105', question: 'loving-better', why: 'wrong-slot' },
    { slug: 'isaiah-26-3', question: 'pressure-at-work', why: 'wrong-slot' },
    { slug: 'romans-6-23', question: 'loving-better', why: 'wrong-slot' },
    // Rewritten into the stillness question's territory.
    { slug: 'romans-12-9-10', question: 'letting-go', why: 'wrong-slot' },
    { slug: '1-peter-3-7', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'genesis-1-1', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'proverbs-18-10', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'isaiah-43-2', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'isaiah-54-10', question: 'letting-go', why: 'wrong-slot' },
    { slug: '2-corinthians-5-7', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'galatians-5-1', question: 'letting-go', why: 'wrong-slot' },
    { slug: 'romans-8-31', question: 'letting-go', why: 'wrong-slot' },
    // One cell holding several complete reflections.
    { slug: 'proverbs-21-5', question: 'letting-go', why: 'merged' },
    { slug: 'galatians-2-20', question: 'loving-better', why: 'merged' },
    // Opens by restating the letting-go question ("Rather than naming what you
    // should release...") under the question about learning to love. Found by
    // the off-slot lint in the build gate, not by the sampled read-throughs.
    { slug: 'galatians-5-22-23', question: 'loving-better', why: 'wrong-slot' },
  ],
  zh: [
    // Opened by restating the letting-go question, with no relationship content.
    { slug: 'proverbs-12-4', question: 'letting-go', why: 'wrong-slot' },
    // Same failure: answers "what should I let go of" under the question about
    // learning to love, and duplicates its own letting-go sibling's framing.
    { slug: 'john-15-5', question: 'loving-better', why: 'wrong-slot' },
  ],
};

/** Everything after the first sentence. */
function bodyAfterFirstSentence(text: string, lang: Lang): string {
  const trimmed = text.trim();
  const parts = trimmed.split(/(?<=[.?!。？！])\s*/);
  if (parts.length < 2) return trimmed;
  return trimmed.slice(parts[0]!.length).trim();
}

function main(): void {
  console.log(`reverting review-damaged cells${DRY ? ' (DRY RUN)' : ''}`);

  for (const lang of ['en', 'zh'] as const) {
    const target = pathFor(lang);
    const backupPath = backupFor(lang);
    if (!existsSync(backupPath)) throw new Error(`missing backup: ${backupPath}`);
    const entries = load(target);
    const backup = load(backupPath);

    let reverted = 0;
    for (const item of REVERTS[lang]) {
      const current = entries[item.slug]?.[item.question];
      const original = backup[item.slug]?.[item.question];
      if (!current || !original) {
        console.warn(`  [${lang}] skip ${item.slug}/${item.question}: cell or backup missing`);
        continue;
      }
      // Idempotent, and safe to re-run after the opening repair: that pass
      // replaces only the FIRST sentence, so a cell already reverted has the
      // original body with a rewritten opener. Comparing bodies (not whole
      // texts) detects that state, and re-applying would otherwise clobber the
      // repaired opener.
      const sameBody =
        bodyAfterFirstSentence(current.text, lang) === bodyAfterFirstSentence(original.text, lang);
      if (sameBody) {
        console.log(`  [${lang}] ${item.slug}/${item.question} already reverted`);
        continue;
      }
      // Text and carry revert together: the pair was written as one unit, and a
      // repaired carry can no longer match a reverted body.
      current.text = original.text;
      current.carry = original.carry;
      reverted++;
      console.log(`  [${lang}] reverted ${item.slug}/${item.question} (${item.why})`);
    }
    console.log(`  [${lang}] ${reverted} cell(s) restored`);

    if (!DRY) writeFileSync(target, `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
  }

  // A revert can restore an opening that a sibling on the same page already
  // uses. Report it rather than leaving it to be discovered on the page.
  console.log('\nsame-page opening check after revert:');
  for (const lang of ['en', 'zh'] as const) {
    const entries = load(pathFor(lang));
    const hits: string[] = [];
    for (const verse of DECK) {
      const seen = new Map<string, string>();
      for (const q of Q_SLUGS) {
        const text = entries[verse.slug]?.[q]?.text;
        if (!text) continue;
        const key = opening(text, lang);
        if (seen.has(key)) hits.push(`${lang} ${verse.slug}: ${q} opens like ${seen.get(key)}`);
        else seen.set(key, q);
      }
    }
    console.log(`  ${lang}: ${hits.length} collision(s)`);
    for (const h of hits) console.log(`    ${h}`);
  }
}

main();
