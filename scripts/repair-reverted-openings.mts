// Rewrite only the OPENING SENTENCE of cells whose topic, closing question and
// body are already correct — used after reverting damaged cells, where the
// restored original opening can collide with a sibling on the same page.
//
// Run: npx tsx scripts/repair-reverted-openings.mts [--dry]
//
// This is deliberately the narrowest possible repair: the body that answers the
// question is preserved verbatim, and only the first sentence is replaced. The
// earlier bulk repair showed that letting the model rewrite whole cells makes it
// drift off the question slot; restricting the edit to one sentence removes
// that failure mode.

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

const splitFirstSentence = (text: string, lang: Lang): { first: string; rest: string } | null => {
  const trimmed = text.trim();
  const parts = trimmed.split(/(?<=[.?!。？！])\s*/);
  if (parts.length < 2) return null;
  const first = parts[0]!;
  const rest = trimmed.slice(first.length).trim();
  if (!first || !rest) return null;
  return { first, rest };
};

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
          max_completion_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) throw new Error('empty');
      return content;
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error(`failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

/** Cells to fix: a cell that opens like a sibling on the same page. */
function findCollisions(lang: Lang, entries: EntryMap): { slug: string; question: string; clashWith: string }[] {
  const out: { slug: string; question: string; clashWith: string }[] = [];
  for (const verse of DECK) {
    const seen = new Map<string, string>();
    for (const q of Q_SLUGS) {
      const text = entries[verse.slug]?.[q]?.text;
      if (!text) continue;
      const key = opening(text, lang);
      if (seen.has(key)) out.push({ slug: verse.slug, question: q, clashWith: seen.get(key)! });
      else seen.set(key, q);
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`rewriting first sentences only${DRY ? ' (DRY RUN)' : ''}`);

  for (const lang of ['en', 'zh'] as const) {
    const entries = load(lang);
    const items = findCollisions(lang, entries);
    if (!items.length) {
      console.log(`[${lang}] no colliding openings`);
      continue;
    }
    console.log(`[${lang}] ${items.length} colliding opening(s)`);

    const system = [
      lang === 'zh'
        ? '你正在改写 Lectio（enjoyhim.org）经文库一条默想的「第一句」，只改这一句。'
        : 'You are rewriting ONLY the first sentence of one entry in the Lectio (enjoyhim.org) verse library.',
      lang === 'zh'
        ? 'Lecio 是默观式读经，不是占卜：经文是与神相遇的契机，绝不预言、绝不宣称神拣选此经文告诉读者该做什么。不要引用所给经文之外的任何出处。'
        : 'Lectio is contemplative reading, not divination: the passage is an occasion to meet God, never a prediction, and never a claim that God chose it to tell the reader what to do. Do not cite any scripture other than the passage given.',
      lang === 'zh'
        ? '新第一句必须以明显不同的字词开头，紧扣这节经文本身，并与后面保留的正文自然衔接（正文一字不改）。长度与原来的第一句相近，一句话，以句号或问号结束。只输出合法 json：{"first": "..."}。'
        : 'The new first sentence must begin with clearly different words, stay anchored to this passage, and connect naturally to the unchanged body that follows. Keep it one sentence, similar length to the original, ending with a period or question mark. Return valid json: {"first": "..."}.',
    ].join('\n');

    let done = 0;
    for (const item of items) {
      const entry = entries[item.slug]?.[item.question];
      if (!entry) continue;
      const split = splitFirstSentence(entry.text, lang);
      if (!split) continue;
      const verse = DECK.find((v) => v.slug === item.slug)!;
      const q = TYPICAL_QUESTIONS.find((t) => t.slug === item.question)!;
      const sibling = entries[item.slug]?.[item.clashWith]?.text ?? '';
      const siblingFirst = splitFirstSentence(sibling, lang)?.first ?? '';

      const user = lang === 'zh'
        ? [
            `经文 ${verse.refZh}（${verse.refEn}），原文：「${verse.textZh}」`,
            `这条默想回答的问题：「${q.questionZh}」`,
            `原来的第一句（要替换）：${split.first}`,
            `同页另一条的开头（必须不同）：${siblingFirst}`,
            `后面保留的正文（不要改）：${split.rest}`,
            '',
            '请只写新的第一句，json 输出。',
          ].join('\n')
        : [
            `Passage ${verse.refEn}, text: "${verse.textEn}"`,
            `This entry answers the question: "${q.questionEn}"`,
            `Current first sentence (replace it): ${split.first}`,
            `Another entry on the same page begins (must differ): ${siblingFirst}`,
            `Body to keep unchanged: ${split.rest}`,
            '',
            'Write only the new first sentence. Reply in json.',
          ].join('\n');

      try {
        const raw = await callModel(system, user);
        const parsed = JSON.parse(raw.replace(/^[^{]*/, '').replace(/[^}]*$/, '') || '{}') as { first?: unknown };
        const first = typeof parsed.first === 'string' ? parsed.first.trim() : '';
        if (!first || first.length < 12) continue;
        if (!/[.?!。？！]$/.test(first)) continue;
        // The whole point is a different opening.
        const candidate = `${first} ${split.rest}`;
        if (opening(candidate, lang) === opening(sibling, lang)) continue;
        if (opening(candidate, lang) === opening(entry.text, lang)) continue;
        entry.text = lang === 'zh' ? `${first}${split.rest}` : candidate;
        if (!DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
        done++;
        console.log(`  [${lang}] ${item.slug}/${item.question} -> ${opening(entry.text, lang)}`);
      } catch (e) {
        console.warn(`  [${lang}] ${item.slug}/${item.question} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`[${lang}] ${done}/${items.length} rewritten; ${findCollisions(lang, entries).length} collision(s) remaining`);
  }
}

await main();
