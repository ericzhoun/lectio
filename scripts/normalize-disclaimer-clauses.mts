// Move honesty clauses out of the closing question and into the body.
//
// Run: npx tsx scripts/normalize-disclaimer-clauses.mts [--dry]
//
// The bulk voice-repair pass taught the model to hedge inside the closing
// question, producing 195 cells shaped like:
//
//   "What fear might you bring before God in a quiet moment, though this
//    passage offers no plan for a less crowded day?"
//   "In what way, though this passage offers no method for stillness, might
//    its assurance help you pause?"
//
// The honesty is right and belongs in the library — a passage that does not
// address a question should say so. But pasted into the question it makes the
// sentence hard to read, and repeating it 195 times is its own template. The
// clause is moved to the front of the closing question as its own short
// sentence, which keeps every word of the disclaimer and leaves the question
// clean:
//
//   "This passage offers no plan for a less crowded day. What fear might you
//    bring before God in a quiet moment?"
//
// Purely mechanical: no text is rewritten, only relocated and re-punctuated,
// so no meaning can drift. Idempotent — a second run finds nothing to move.

import { readFileSync, writeFileSync } from 'node:fs';
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
const load = (lang: Lang): EntryMap => JSON.parse(readFileSync(pathFor(lang), 'utf8'));

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

/**
 * Split a reflection into (body, closing question). The closing question is the
 * final sentence and must end in a question mark.
 */
function split(text: string): { body: string; question: string } | null {
  const trimmed = text.trim();
  if (!/\?$/.test(trimmed)) return null;
  const parts = trimmed.split(/(?<=[.?!])\s+/);
  const question = parts[parts.length - 1]!;
  const body = trimmed.slice(0, trimmed.length - question.length).trim();
  if (!body || !question.endsWith('?')) return null;
  return { body, question };
}

/**
 * Pull a hedge clause out of a question.
 *
 * Handles the two shapes the generator produced:
 *   trailing — "Q, though CLAUSE?"          -> question "Q?", clause "CLAUSE"
 *   medial   — "PRE, though CLAUSE, POST?"  -> question "PRE POST?", clause "CLAUSE"
 *
 * Returns null when the question carries no such clause. The clause is matched
 * to a comma boundary (or the question mark) so it is never cut mid-phrase.
 */
function extractClause(question: string): { question: string; clause: string } | null {
  // The hedge always begins with one of these connectives.
  const start = question.search(/,\s+(?:though|even though|although)\s+/i);
  if (start === -1) return null;

  const afterComma = question.slice(start + 2); // 'though ...'
  // The clause runs to the next comma, or to the question mark.
  const nextComma = afterComma.search(/,\s+/);
  const endOfClause = nextComma === -1 ? afterComma.length - 1 : nextComma; // -1 to drop '?'
  const clauseRaw = afterComma.slice(0, endOfClause).trim().replace(/[,?]+$/, '');
  if (!clauseRaw) return null;

  // Rebuild the question from the remaining halves.
  const before = question.slice(0, start).trim();
  let remainder = '';
  if (nextComma === -1) {
    // Trailing clause: the question is everything before it, plus '?'.
    remainder = `${before}?`;
  } else {
    // Medial clause: the two halves join directly.
    const after = afterComma.slice(nextComma + 2).trim();
    remainder = `${before} ${after}`.trim();
  }
  if (!remainder.endsWith('?')) remainder = `${remainder.replace(/[,\s]+$/, '')}?`;
  if (before.length === 0 || remainder.replace(/[?\s]/g, '') === '') return null;

  // The clause becomes its own sentence. It must therefore drop the
  // subordinating connective: "Though this passage offers no plan..." is a
  // fragment on its own, while "This passage offers no plan..." is a sentence.
  // The hedge's meaning is unchanged — it still says the passage does not
  // address the question.
  const bare = clauseRaw.replace(/^(?:even\s+)?(?:though|although)\s+/i, '').trim();
  const sentence = bare.charAt(0).toUpperCase() + bare.slice(1);
  return { question: remainder, clause: `${sentence}.` };
}

function main(): void {
  console.log(`moving hedge clauses out of closing questions${DRY ? ' (DRY RUN)' : ''}`);

  // Cells whose hedge is not a comma-delimited clause. Either the body already
  // states the disclaimer (so the tail is redundant and is dropped), or the
  // hedge sits in an em-dash aside (so it is restated as a leading sentence).
  // Keyed by the exact tail so every edit is auditable, and deliberately narrow:
  // "as though the whole world rested on your effort" is ordinary English, not
  // a disclaimer, and must not be touched.
  const DROP_REDUNDANT_TAIL: Record<string, { slug: string; question: string; tail: string; replacement: string }> = {
    'romans-12-10/stillness': {
      slug: 'romans-12-10',
      question: 'stillness',
      tail: ', letting this invitation to tender affection shape your attention even though it does not directly address stillness?',
      replacement: ', letting this invitation to tender affection shape your attention?',
    },
    '1-corinthians-7-3-4/pressure-at-work': {
      slug: '1-corinthians-7-3-4',
      question: 'pressure-at-work',
      tail: 'When in this pressured season\u2014though these words concern marriage, not work\u2014could you pause to notice the care you and your spouse need from each other, if you are married?',
      replacement: 'These words concern marriage, not work. If you are married, could you pause in this pressured season to notice the care you and your spouse need from each other?',
    },
    'james-1-22/pressure-at-work': {
      slug: 'james-1-22',
      question: 'pressure-at-work',
      tail: 'How much of your response to work pressure\u2014though this verse offers no workplace strategy\u2014reflects what you believe, and where might one ordinary choice bring the two closer?',
      replacement: 'This verse offers no workplace strategy. How much of your response to work pressure reflects what you believe, and where might one ordinary choice bring the two closer?',
    },
  };

  let totalMoved = 0;

  for (const lang of ['en'] as const) {
    const entries = load(lang);
    let moved = 0;
    const samples: string[] = [];

    // Exact-tail fixes first, before the generic clause mover runs.
    for (const fix of Object.values(DROP_REDUNDANT_TAIL)) {
      const entry = entries[fix.slug]?.[fix.question];
      if (!entry || !entry.text.includes(fix.tail)) continue;
      entry.text = entry.text.replace(fix.tail, fix.replacement);
      moved++;
      console.log(`  [${lang}] fixed hedge in ${fix.slug}/${fix.question}`);
    }

    for (const [slug, byQuestion] of Object.entries(entries)) {
      for (const [q, entry] of Object.entries(byQuestion)) {
        const splitText = split(entry.text);
        if (!splitText) continue;
        const extracted = extractClause(splitText.question);
        if (!extracted) continue;

        const moved__ = `${splitText.body} ${extracted.clause} ${extracted.question}`.replace(/\s+/g, ' ').trim();
        if (samples.length < 5) {
          samples.push(
            `${slug}/${q}\n   was: ${splitText.question}\n   now: ${extracted.clause} ${extracted.question}`
          );
        }
        entry.text = moved__;
        moved++;
      }
    }

    console.log(`  [${lang}] ${moved} clause(s) moved`);
    for (const s of samples) console.log(`   ${s}`);
    if (moved && !DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
    totalMoved += moved;
  }

  console.log(`\ntotal moved: ${totalMoved}`);
  if (DRY) console.log('(dry run: nothing written)');
}

main();
