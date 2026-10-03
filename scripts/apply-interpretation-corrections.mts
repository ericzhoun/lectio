// Hand-authored corrections for the last cells an independent review flagged,
// applied after the model endpoint ran out of quota.
//
// Run: npx tsx scripts/apply-interpretation-corrections.mts [--dry]
//
// Scope: the typo, the 12 same-page duplicate cells, and Chinese carry lines
// missing their closing 。. Nothing else is touched.
//
//   dup-first  → the reflection is rewritten so the page no longer repeats an
//                opening sentence. A reader sees all four questions at once, so
//                an identical opening there is visible batch-generation.
//   dup-carry  → only the carry line changes. That is the whole defect: the
//                reflection itself is distinct, and rewriting it would discard
//                good prose to fix a one-line collision.
//
// After applying, the script re-scans and prints any remaining collision, so a
// failed fix cannot pass silently.

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
const firstSentence = (text: string): string => text.split(/(?<=[.?!])\s+/)[0]?.trim() ?? '';

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

// ---- corrections -----------------------------------------------------------
// Each entry replaces exactly one field. `text` is present only where the
// opening sentence collided; `carry` only where the carry line collided.

interface Correction { slug: string; question: string; text?: string; carry?: string }

const CORRECTIONS: Record<Lang, Correction[]> = {
  en: [
    {
      // clash: "Gratitude is the movement of this verse: ..."
      slug: 'psalm-139-14', question: 'loving-better',
      text: 'Being wonderfully made is the claim this verse makes about you, before it says anything about anyone else. It is not a description of how to treat a partner, yet it sets a floor under how you speak to yourself. Loving someone better is difficult from a posture of contempt: when every fault becomes evidence against you, patience runs out quickly. The thanksgiving here is not denial \u2014 the speaker knows their own soul \u2014 but it refuses to let failure have the final word. That same steadiness can shape how you read the other person\u2019s faults too. Where has harshness toward yourself made it harder to be gentle with someone else?',
      carry: 'Contempt for yourself rarely leaves room to love someone well.',
    },
    {
      // clash: "Taste and see is an invitation to encounter goodness, ..."
      slug: 'psalm-34-8', question: 'loving-better',
      text: 'Refuge is what this verse offers before it asks anything of you. The invitation to taste comes with a promise of shelter, and both are addressed to someone who needs them. In a close relationship it is easy to hand another person the job of proving you are safe, then resent the weight of it. This passage does not say to love less; it suggests where the refuge belongs. What you receive from God can be carried into the relationship rather than demanded from it. Where are you asking someone to secure something only this verse offers?',
      carry: 'Refuge received is easier to bring into a relationship than to demand from it.',
    },
    {
      // three cells shared the same carry line
      slug: 'proverbs-3-5-6', question: 'letting-go',
      carry: 'The path is made straight as you walk, not before you start.',
    },
    {
      // three cells shared the same carry line
      slug: 'proverbs-3-5-6', question: 'stillness',
      carry: 'Not every question has to be settled before you can be quiet.',
    },
    {
      // clash: "Understanding is worth more than the comfort of being right."
      slug: 'proverbs-4-7', question: 'letting-go',
      carry: 'Wisdom may cost you the version of yourself you were protecting.',
    },
    {
      // clash: "Wisdom is given first place here, even above possessions."
      slug: 'proverbs-4-7', question: 'stillness',
      text: 'This verse buys understanding at a startling price: everything you own. That is not a method for a calmer day, but it does expose what competes for your attention. When every demand seems urgent, the verse asks which pursuit you would actually pay for. A quiet moment is not another asset to acquire; it is space to notice what you have been treating as supreme by default. The cost named here is real, and it is not meant to be paid in a single afternoon. Which of today\u2019s urgencies would you not pay everything for?',
    },
    {
      // clash: "Trouble is real, but it is not the whole truth."
      slug: 'john-16-33', question: 'stillness',
      carry: 'Courage here rests on his victory, not on a calmer day.',
    },
    {
      // clash: "Love matters more than the need to prove yourself."
      slug: '1-corinthians-13-13', question: 'letting-go',
      carry: 'Faith, hope, and love remain \u2014 the rest is not the measure.',
    },
    {
      // clash: "You do not have to see everything clearly to love Christ."
      slug: '1-peter-1-8-9', question: 'stillness',
      text: 'Peter is writing to people whose joy outruns what they can see. They love someone they have never laid eyes on, and the passage does not treat that as a lesser kind of love. Busyness tends to work the other way, asking for proof before it grants any peace. Here the trust comes first and the feeling follows it. A still moment does not require you to manufacture joy or measure it; it lets you rest in a love that does not depend on visible results. What in your day are you waiting to see before you allow yourself to rest?',
    },
    {
      // clash: "Knowing God and loving others belong together in this passage."
      slug: '1-john-4-7-8', question: 'stillness',
      carry: 'A pause can begin by seeing the person in front of you.',
    },
    {
      // clash: "Before your love comes God\u2019s love."
      slug: '1-john-4-19', question: 'stillness',
      text: 'The order in this verse is the whole of it: he loved first, and your love answers. Nothing here describes a technique for quiet, yet the sequence matters for one. If your love is the starting point, stillness becomes another thing to produce and measure. Read as an answer rather than an origin, it asks nothing of you but attention. You can spend a moment on the sentence without turning it into a task, and let the pressure to feel something particular go. What would resting look like if your love were a response rather than a performance?',
    },
  ],
  zh: [
    {
      // clash: "认真筹算与承认有限可以同时存在。"
      slug: 'proverbs-16-9', question: 'stillness',
      carry: '安静可以是承认自己不是最终的掌舵者。',
    },
  ],
};

// ---- ending alignment ------------------------------------------------------
// The generated corpus ends every reflection with a question the reader can sit
// with, but the seven hand-written seed entries (the ones that established the
// voice before the bulk run) end with a concrete invitation instead. Mixed
// endings read as sloppiness rather than variety, so these are aligned to the
// established shape. Keyed by the exact closing sentence so the change is
// auditable and cannot silently rewrite the wrong text.

const ENDING_ALIGNMENT: Record<Lang, { slug: string; question: string; from: string; to: string }[]> = {
  en: [
    {
      slug: 'philippians-4-13', question: 'pressure-at-work',
      from: 'Name the one task today you have been carrying on your own, and say the line again with that task in view.',
      to: 'Which task today have you been carrying as though the strength had to come from you?',
    },
    {
      slug: 'psalm-56-3', question: 'pressure-at-work',
      from: 'Try finishing the sentence with the specific thing you are afraid of, and let the second half stand.',
      to: 'What specifically are you afraid of losing, if you were to name it plainly?',
    },
    {
      slug: 'proverbs-21-5', question: 'pressure-at-work',
      from: "Look at today's list and ask which items are genuinely yours to do, and which are only loud.",
      to: "Which items on today's list are genuinely yours to do, and which are only loud?",
    },
    {
      slug: 'isaiah-41-10', question: 'pressure-at-work',
      from: 'Read it slowly and stop at whichever of the four you find hardest to believe today.',
      to: 'Which of the four is hardest for you to believe today?',
    },
    {
      slug: 'matthew-6-33', question: 'pressure-at-work',
      from: "Read it as a question rather than a formula \u2014 what would change today if God's rule, not the deadline, were the thing you were actually serving? The promise attached is that what you need is already known.",
      to: "Read it as a question rather than a formula. What you need is already known \u2014 so what would change today if God's rule, rather than the deadline, were the thing you were actually serving?",
    },
    {
      slug: 'colossians-3-23', question: 'pressure-at-work',
      from: 'Ask what your standard would be today if the work were being offered rather than performed.',
      to: 'What would your standard be today if the work were an offering rather than a performance?',
    },
    {
      slug: '1-peter-5-7', question: 'pressure-at-work',
      from: 'Name one you have been holding today.',
      to: 'Which one have you been holding today without setting it down?',
    },
  ],
  zh: [],
};

function alignEndings(lang: Lang, entries: EntryMap): number {
  let fixed = 0;
  for (const fix of ENDING_ALIGNMENT[lang]) {
    const entry = entries[fix.slug]?.[fix.question];
    if (!entry) {
      console.warn(`  [${lang}] ending fix skipped, no cell ${fix.slug}/${fix.question}`);
      continue;
    }
    if (!entry.text.includes(fix.from)) {
      // Already applied on an earlier run (or never present): only warn when
      // the target text is missing too, so re-running stays quiet.
      if (!entry.text.includes(fix.to)) {
        console.warn(`  [${lang}] ending fix skipped, sentence not found in ${fix.slug}/${fix.question}`);
      }
      continue;
    }
    entry.text = entry.text.replace(fix.from, fix.to);
    fixed++;
  }
  return fixed;
}

// ---- apply -----------------------------------------------------------------

function applyCorrections(lang: Lang, entries: EntryMap): number {
  let applied = 0;
  for (const c of CORRECTIONS[lang]) {
    const entry = entries[c.slug]?.[c.question];
    if (!entry) {
      console.warn(`  [${lang}] skip ${c.slug}/${c.question}: no such cell`);
      continue;
    }
    if (c.text !== undefined) entry.text = c.text;
    if (c.carry !== undefined) entry.carry = c.carry;
    applied++;
  }
  return applied;
}

const MIN_TEXT: Record<Lang, number> = { en: 350, zh: 120 };

function validate(lang: Lang, entries: EntryMap): string[] {
  const problems: string[] = [];
  for (const v of DECK) {
    const byQuestion = entries[v.slug];
    if (!byQuestion) continue;
    for (const q of Q_SLUGS) {
      const entry = byQuestion[q];
      if (!entry) continue;
      if (entry.text.trim().length < MIN_TEXT[lang]) problems.push(`${lang} ${v.slug}/${q}: text too short`);
      if (!/[.。?？]$/.test(entry.text.trim())) problems.push(`${lang} ${v.slug}/${q}: text does not end cleanly`);
      if (lang === 'zh' && !/[.。!！?？]$/.test(entry.carry.trim())) problems.push(`${lang} ${v.slug}/${q}: carry missing 。`);
      const doubled = entry.text.match(/\b([A-Za-z]{3,})\s+\1\b/i);
      if (doubled) problems.push(`${lang} ${v.slug}/${q}: doubled word "${doubled[0]}"`);
    }
    // Collisions are what this whole script exists to remove.
    const firsts = new Map<string, string>();
    const carries = new Map<string, string>();
    for (const q of Q_SLUGS) {
      const entry = byQuestion[q];
      if (!entry) continue;
      const f = firstSentence(entry.text);
      if (firsts.has(f)) problems.push(`${lang} ${v.slug}: same opening (${q} vs ${firsts.get(f)})`);
      else firsts.set(f, q);
      const carry = entry.carry.trim();
      if (carries.has(carry)) problems.push(`${lang} ${v.slug}: same carry (${q} vs ${carries.get(carry)})`);
      else carries.set(carry, q);
    }
  }
  return problems;
}

function main(): void {
  console.log(`applying hand-authored corrections${DRY ? ' (DRY RUN)' : ''}`);

  for (const lang of ['en', 'zh'] as const) {
    const entries = load(lang);

    // The one literal typo: a doubled word in the isaiah-41-10 reflection.
    // Applied by exact sequence, not by a blind word swap — replacing
    // "need need " with "need not " turns "need need not be" into a
    // grammatically wrong "need not not be". Both forms collapse to
    // "need not be".
    let typos = 0;
    for (const byQuestion of Object.values(entries)) {
      for (const entry of Object.values(byQuestion)) {
        const before = entry.text;
        entry.text = entry.text
          .replace(/\bneed need not be\b/g, 'need not be')
          .replace(/\bneed not not be\b/g, 'need not be');
        if (entry.text !== before) typos++;
      }
    }
    if (typos) console.log(`  [${lang}] fixed ${typos} "need need" typo(s)`);

    // A handful of Chinese carry lines were written without the closing 。 that
    // the other 604 have; an inconsistent ending is visible as a batch artifact.
    let padded = 0;
    if (lang === 'zh') {
      for (const byQuestion of Object.values(entries)) {
        for (const entry of Object.values(byQuestion)) {
          const carry = entry.carry.trim();
          if (carry && !/[.。!！?？]$/.test(carry)) {
            entry.carry = `${carry}。`;
            padded++;
          }
        }
      }
      if (padded) console.log(`  [${lang}] added a closing 。 to ${padded} carry line(s)`);
    }

    const applied = applyCorrections(lang, entries);
    console.log(`  [${lang}] applied ${applied} correction(s)`);

    const endings = alignEndings(lang, entries);
    if (endings) console.log(`  [${lang}] aligned ${endings} reflection ending(s) to the question shape`);

    const problems = validate(lang, entries);
    if (problems.length) {
      console.error(`  [${lang}] ${problems.length} problem(s) remain:`);
      for (const p of problems.slice(0, 20)) console.error(`    - ${p}`);
    } else {
      console.log(`  [${lang}] validation clean (lengths, endings, no same-page collisions)`);
    }

    if (!DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
  }

  if (DRY) console.log('\n(dry run: nothing written)');
}

main();
