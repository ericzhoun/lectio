// Repair the specific defects an independent review found in the generated
// verse interpretations. Narrow by design: it fixes only the cells named
// below, in place, and leaves the other ~1200 entries untouched rather than
// regenerating the library.
//
// Run:  npx tsx scripts/repair-verse-interpretations.mts [--dry]
//
// Fixes:
//   1. The one literal typo ("need need").
//   2. Same-page duplicates: when two of the four questions on a verse page
//      share an identical opening sentence or an identical carry line, the
//      later cell is rewritten. A reader sees all four on one page, so a
//      repeat there is visible; across pages it is not.
//   3. Chinese carry lines missing their closing 。
//
// Uses the same local opencodex endpoint as the generator. The rewrite prompt
// demands a different opening and forbids reusing the sibling wording.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLibraryVerses } from '../src/lib/scripture';
import { TYPICAL_QUESTIONS } from '../src/lib/verseQuestions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = process.env.OCX_ENDPOINT ?? 'http://127.0.0.1:10100/v1/chat/completions';
const MODEL = process.env.OCX_MODEL ?? 'gpt-6.1-sol--fast';
const DRY = process.argv.includes('--dry');

type Lang = 'en' | 'zh';
interface Interpretation { text: string; carry: string }
type EntryMap = Record<string, Record<string, Interpretation>>;

const DECK = getLibraryVerses();
const Q_SLUGS = TYPICAL_QUESTIONS.map((q) => q.slug);
const pathFor = (lang: Lang) => resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`);
const load = (lang: Lang): EntryMap => JSON.parse(readFileSync(pathFor(lang), 'utf8'));

const firstSentence = (text: string): string => text.split(/(?<=[.?!])\s+/)[0]?.trim() ?? '';

// ---- the cells to rewrite --------------------------------------------------
// Discovered by scanning, not hard-coded: any same-page pair sharing an opening
// sentence or a carry. The later cell in question order is the one rewritten so
// the page keeps its first occurrence intact.

interface Fix { slug: string; question: string; kind: 'dup-first' | 'dup-carry'; clashWith: string; clash: string }

function findDuplicates(entries: EntryMap): Fix[] {
  const fixes: Fix[] = [];
  for (const [slug, byQuestion] of Object.entries(entries)) {
    const seenFirst = new Map<string, string>();
    const seenCarry = new Map<string, string>();
    for (const q of Q_SLUGS) {
      const entry = byQuestion[q];
      if (!entry) continue;
      const first = firstSentence(entry.text);
      const carry = entry.carry.trim();
      if (seenFirst.has(first)) {
        fixes.push({ slug, question: q, kind: 'dup-first', clashWith: seenFirst.get(first)!, clash: first });
      } else {
        seenFirst.set(first, q);
      }
      if (seenCarry.has(carry)) {
        fixes.push({ slug, question: q, kind: 'dup-carry', clashWith: seenCarry.get(carry)!, clash: carry });
      } else {
        seenCarry.set(carry, q);
      }
    }
  }
  return fixes;
}

// ---- model call ------------------------------------------------------------

async function callModel(system: string, user: string, attempts = 4): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.95,
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('truncated');
      const content = choice?.message?.content ?? '';
      if (!content.trim()) throw new Error('empty');
      return content;
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error(`failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

const SHAPE_EN =
  'Return valid json only: an object with exactly two string fields, "text" (the rewritten reflection) and "carry" (the short line).';
const SHAPE_ZH =
  '只输出合法的 json：恰好两个字符串字段，"text"（重写的默想正文）与 "carry"（短句）。';

function systemPrompt(lang: Lang): string {
  const base = lang === 'zh'
    ? [
        '你正在为 Lectio（enjoyhim.org）的经文库重写一条「常见问题的默想」。',
        'Lectio 是默观式读经，不是占卜：经文是与神相遇的契机，绝不宣称神拣选这节经文来告诉读者该怎么做，绝不预言将来。',
        '不要引用所给经文之外的任何圣经出处。若经文确实不直答该问题，用一句话诚实说明，再带出仍然成立的部分。',
        '语气温和平实，用「你」称呼读者。不用感叹号，不用表情符号。',
        '正文 180-260 个汉字，结尾是一个读者可以驻足其上的真实问题，并以？收尾。',
      ]
    : [
        'You are rewriting one entry of the Lectio (enjoyhim.org) verse library: a reflection on how a passage speaks to a reader\'s question.',
        'Lectio is contemplative reading, not divination: the passage is an occasion to meet God, never a claim that God chose it to tell the reader what to do, and never a prediction.',
        'Do not cite any scripture other than the passage given. If the passage does not directly address the question, say so honestly in one clause and then draw out what it does still offer.',
        'Tone: warm, plain, unhurried, second person. No exclamation marks, no emoji.',
        'Write 95-130 words, ending with one real question the reader could sit with.',
      ];
  return [...base, lang === 'zh' ? SHAPE_ZH : SHAPE_EN].join('\n');
}

function userPrompt(lang: Lang, fix: Fix, entries: EntryMap, sibling: Interpretation): string {
  const verse = DECK.find((v) => v.slug === fix.slug);
  if (!verse) throw new Error(`unknown verse slug ${fix.slug}`);
  const question = TYPICAL_QUESTIONS.find((q) => q.slug === fix.question)!;
  const lines: string[] = [];
  if (lang === 'zh') {
    lines.push(`经文 ${verse.refZh}（${verse.refEn}），主题 ${verse.themeZh}`);
    lines.push(`原文：「${verse.textZh}」`);
    lines.push(`要回答的问题：「${question.questionZh}」`);
    lines.push('');
    lines.push(`同一页面上「${TYPICAL_QUESTIONS.find((q) => q.slug === fix.clashWith)!.questionZh}」那一条已经这样写：`);
    lines.push(`  正文开头：${fix.kind === 'dup-first' ? fix.clash : firstSentence(sibling.text)}`);
    lines.push(`  带到一天的短句：${sibling.carry}`);
    lines.push('');
    lines.push('请重写这一条：');
    lines.push('- 开头的方式必须与上面那条明显不同（不要沿用同样的起句或句式）。');
    lines.push('- 短句必须不同：换一个角度，不要只是同义改写。');
    lines.push('- 内容仍须紧扣这节经文自己的用词与意象。');
  } else {
    lines.push(`Passage ${verse.refEn} (${verse.refZh}), theme ${verse.themeEn}`);
    lines.push(`Text: "${verse.textEn}"`);
    lines.push(`Question to answer: "${question.questionEn}"`);
    lines.push('');
    lines.push(`Another entry on the same page (for the question "${TYPICAL_QUESTIONS.find((q) => q.slug === fix.clashWith)!.questionEn}") already reads:`);
    lines.push(`  opening: ${fix.kind === 'dup-first' ? fix.clash : firstSentence(sibling.text)}`);
    lines.push(`  carry line: ${sibling.carry}`);
    lines.push('');
    lines.push('Rewrite this entry so that:');
    lines.push('- the opening is clearly different from the one above (do not reuse its opening words or sentence shape);');
    lines.push('- the carry line is genuinely different — a different angle, not a paraphrase;');
    lines.push('- the reflection still engages this passage\'s own words and imagery.');
  }
  lines.push('');
  lines.push(lang === 'zh' ? '用 json 输出。' : 'Reply in json.');
  return lines.join('\n');
}

function parse(raw: string): Interpretation {
  let data: unknown;
  try { data = JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('not json');
    data = JSON.parse(m[0]);
  }
  const d = data as { text?: unknown; carry?: unknown };
  if (typeof d.text !== 'string' || typeof d.carry !== 'string') throw new Error('wrong shape');
  return { text: d.text.trim(), carry: d.carry.trim() };
}

function validRewrite(lang: Lang, value: Interpretation, fix: Fix, entries: EntryMap, sibling: Interpretation): boolean {
  const minText = lang === 'zh' ? 120 : 350;
  if (value.text.length < minText || value.text.length > 1600) return false;
  if (value.carry.length < 6 || value.carry.length > 140) return false;
  if (!/[.。?？]$/.test(value.text)) return false;
  // The rewrite must actually differ from what it replaces and from the clash.
  if (value.text === entries[fix.slug]![fix.question]!.text) return false;
  if (firstSentence(value.text) === fix.clash) return false;
  if (value.carry === sibling.carry) return false;
  if (value.carry === fix.clash) return false;
  return true;
}

// ---- fixes -----------------------------------------------------------------

async function repairLanguage(lang: Lang): Promise<void> {
  const entries = load(lang);
  const fixes = findDuplicates(entries);
  console.log(`[${lang}] ${fixes.length} duplicate cell(s) to rewrite`);
  let ok = 0;

  for (const fix of fixes) {
    const sibling = entries[fix.slug]![fix.clashWith]!;
    try {
      const raw = await callModel(systemPrompt(lang), userPrompt(lang, fix, entries, sibling));
      const value = parse(raw);
      if (!validRewrite(lang, value, fix, entries, sibling)) {
        console.warn(`  [${lang}] ${fix.slug}/${fix.question}: rewrite rejected (still too similar or wrong length)`);
        continue;
      }
      if (!DRY) {
        entries[fix.slug]![fix.question] = value;
        writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
      }
      ok++;
      console.log(`  [${lang}] ${fix.slug}/${fix.question} (${fix.kind}) rewritten`);
    } catch (e) {
      console.warn(`  [${lang}] ${fix.slug}/${fix.question}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`[${lang}] ${ok}/${fixes.length} rewritten`);

  // Chinese carries must end in a full stop like the other 604 do.
  if (lang === 'zh' && !DRY) {
    let padded = 0;
    for (const byQuestion of Object.values(entries)) {
      for (const entry of Object.values(byQuestion)) {
        const carry = entry.carry.trim();
        if (carry && !/[.。!！?？]$/.test(carry)) {
          entry.carry = `${carry}。`;
          padded++;
        }
      }
    }
    if (padded) {
      writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
      console.log(`[${lang}] added a closing 。 to ${padded} carry line(s)`);
    }
  }
}

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

async function main(): Promise<void> {
  console.log(`endpoint ${ENDPOINT} · model ${MODEL}${DRY ? ' · DRY RUN' : ''}`);

  // 1. The literal typo, in place. Narrow and unambiguous.
  for (const lang of ['en'] as const) {
    const entries = load(lang);
    let hit = 0;
    for (const byQuestion of Object.values(entries)) {
      for (const entry of Object.values(byQuestion)) {
        if (entry.text.includes('need need ')) {
          entry.text = entry.text.replace(/need need /g, 'need not ');
          hit++;
        }
      }
    }
    if (hit && !DRY) {
      writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
    }
    console.log(`[${lang}] fixed ${hit} "need need" typo(s)`);
  }

  for (const lang of ['en', 'zh'] as const) await repairLanguage(lang);

  for (const lang of ['en', 'zh'] as const) {
    const entries = load(lang);
    const left = findDuplicates(entries);
    console.log(`[${lang}] duplicate cells remaining: ${left.length}`);
    for (const l of left) console.log(`   ${l.slug}/${l.question} (${l.kind})`);
  }
}

await main();
