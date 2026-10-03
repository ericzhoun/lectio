// Break up the batch-generated monotony in the verse interpretations.
//
// Run:  npx tsx scripts/repair-verse-voice.mts [flags]
//   --langs=en,zh     languages to treat (default both)
//   --phase=a,b       run only these phases (default both)
//   --limit=N         cap cells per phase, for a pilot run
//   --concurrency=5   calls in flight
//   --dry             report the plan without calling the model or writing
//
// Why this exists: the first full generation produced prose that is doctrinally
// clean but audibly machine-made when read across pages —
//
//   Phase A (openings): 94 of 157 English pages and 19 of 157 Chinese pages
//   answered two of their own four questions with the same opening words. A
//   reader sees all four on one page, so that reads as a template. One cell per
//   colliding pair is rewritten in full; the other three are left alone, since
//   the collision is what is visible, not the sentence.
//
//   Phase B (closings): 100% of reflections end in a question, and the opening
//   word of those questions is heavily skewed (English: What 360, Where 145,
//   Which 77; Chinese: 此刻 189, 今天 71, 在这 49). Only the final question is
//   rewritten, so the reflection keeps the body that was already good. Target
//   opening words are assigned round-robin to flatten the distribution.
//
// Both phases are resumable and write after every batch. Measurement is
// scripts/audit-interpretation-voice.mjs; re-run it afterwards to see the
// before/after numbers.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLibraryVerses } from '../src/lib/scripture';
import { TYPICAL_QUESTIONS } from '../src/lib/verseQuestions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = process.env.OCX_ENDPOINT ?? 'http://127.0.0.1:10100/v1/chat/completions';
const MODEL = process.env.OCX_MODEL ?? 'gpt-6.1-sol--fast';

type Lang = 'en' | 'zh';
interface Interpretation { text: string; carry: string }
type EntryMap = Record<string, Record<string, Interpretation>>;

const DECK = getLibraryVerses();
const Q_SLUGS = TYPICAL_QUESTIONS.map((q) => q.slug);
const pathFor = (lang: Lang) => resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`);
const load = (lang: Lang): EntryMap => JSON.parse(readFileSync(pathFor(lang), 'utf8'));

// ---- flags -----------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string, fallback: string | null = null): string | null {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? 'true' : hit.slice(eq + 1);
}
const LANGS = (flag('langs', 'en,zh') as string).split(',').filter((l): l is Lang => l === 'en' || l === 'zh');
const PHASES = (flag('phase', 'a,b,c,d') as string).split(',');
const LIMIT = Number(flag('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(flag('concurrency', '5')));
const DRY = flag('dry') === 'true';

// ---- text helpers ----------------------------------------------------------

const sentences = (text: string): string[] =>
  text
    .trim()
    .split(/(?<=[.?!])\s+|(?<=[\u3002\uff01\uff1f])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Opening n-gram used for collision detection (chars for zh, words for en). */
function opening(text: string, lang: Lang): string {
  const clean = text.replace(/^[\s"'“‘([「『]+/, '').trim();
  if (lang === 'zh') return clean.replace(/[\s\u3000]/g, '').slice(0, 4);
  return clean.split(/\s+/).slice(0, 2).join(' ').replace(/[^A-Za-z' ]/g, '').toLowerCase();
}

/** Split a reflection into (body, final question); null when it has no question. */
function splitFinalQuestion(text: string, lang: Lang): { body: string; question: string } | null {
  const trimmed = text.trim();
  if (!/[?\uff1f]$/.test(trimmed)) return null;
  const parts = sentences(trimmed);
  const last = parts[parts.length - 1];
  if (!last || !trimmed.endsWith(last)) return null;
  const body = trimmed.slice(0, trimmed.length - last.length).trim();
  if (!body) return null;
  return { body, question: last };
}

/** The word a closing question starts with, for distribution counting. */
function closerOpener(question: string, lang: Lang): string {
  const clean = question.replace(/^[\s"'“‘([「『]+/, '');
  if (lang === 'zh') return clean.slice(0, 2);
  return clean.split(/\s+/)[0]?.toLowerCase() ?? '';
}

// ---- target opener pools ---------------------------------------------------
// Assigned round-robin to whichever cells are being rewritten, so the repaired
// questions spread across these instead of piling onto one word. Every entry is
// a question-initial form that occurs naturally in devotional prose.

const CLOSER_POOL: Record<Lang, string[]> = {
  en: [
    'How', 'What', 'Where', 'Which', 'Who', 'When',
    'In what way', 'What if', 'Is there', 'Which part of',
    'Where in', 'What in', 'When in', 'How much of',
  ],
  zh: [
    '此刻', '今天', '在这', '面对', '当你', '若不', '你想', '在你',
    '如果', '什么', '你能', '是否', '哪一处', '什么时候', '为何', '怎样',
  ],
};

// Cap per opening word: anything above this gets rewritten. Chosen so no single
// opener dominates (628 cells spread over 14-16 forms lands near 40 each, and
// the untouched remainder already sits well under the cap).
const CLOSER_CAP: Record<Lang, number> = { en: 70, zh: 55 };

// ---- model -----------------------------------------------------------------

async function callModel(system: string, user: string, attempts = 4, maxTokens = 8000): Promise<string> {
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
          max_completion_tokens: maxTokens,
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
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`failed: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('not json');
    return JSON.parse(m[0]) as Record<string, unknown>;
  }
}

const STANCE_EN =
  'Lectio is contemplative reading, not divination: the passage is an occasion to meet God, never a claim that God chose it to tell the reader what to do, and never a prediction. Do not cite any scripture other than the passage given. If the passage does not address the question directly, say so honestly in one clause before drawing out what it does offer. Tone: warm, plain, unhurried, second person. No exclamation marks, no emoji.';
const STANCE_ZH =
  'Lectio 是默观式读经，不是占卜：经文是与神相遇的契机，绝不宣称神拣选这节经文来告诉读者该怎么做，绝不预言将来。不要引用所给经文之外的任何圣经出处。若经文确实不直答该问题，先用一句话诚实说明，再带出仍然成立的部分。语气温和平实，用「你」称呼读者。不用感叹号，不用表情符号。';

/** Describe one work item for a prompt. */
function describe(lang: Lang, item: { slug: string; question: string; body?: string; opener?: string; sentences?: number }): string {
  const verse = DECK.find((v) => v.slug === item.slug);
  if (!verse) throw new Error(`unknown slug ${item.slug}`);
  const q = TYPICAL_QUESTIONS.find((t) => t.slug === item.question)!;
  if (lang === 'zh') {
    const lines = [
      `slug ${item.slug}｜经文 ${verse.refZh}（${verse.refEn}）｜主题 ${verse.themeZh}`,
      `原文：「${verse.textZh}」`,
      `读者的问题：「${q.questionZh}」`,
    ];
    if (item.body) lines.push(`现有正文（保留）：${item.body}`);
    if (item.opener) lines.push(`新收尾问题必须以「${item.opener}」开头。`);
    if (item.sentences) lines.push(`正文目标长度：约 ${item.sentences} 句、180-260 字。`);
    return lines.join('\n');
  }
  const lines = [
    `slug ${item.slug} | passage ${verse.refEn} (${verse.refZh}) | theme ${verse.themeEn}`,
    `Text: "${verse.textEn}"`,
    `Question: "${q.questionEn}"`,
  ];
  if (item.body) lines.push(`Existing body (keep it): ${item.body}`);
  if (item.opener) lines.push(`The new closing question MUST begin with the word "${item.opener}".`);
  if (item.sentences) lines.push(`Target length: about ${item.sentences} sentences, 95-130 words.`);
  return lines.join('\n');
}

// ---- phase A: openings -----------------------------------------------------

interface CollisionItem { slug: string; question: string; clashWith: string; opener: string }

function findCollisions(lang: Lang, entries: EntryMap): CollisionItem[] {
  const out: CollisionItem[] = [];
  for (const verse of DECK) {
    const seen = new Map<string, string>();
    for (const q of Q_SLUGS) {
      const text = entries[verse.slug]?.[q]?.text;
      if (!text) continue;
      const key = opening(text, lang);
      if (seen.has(key)) {
        out.push({ slug: verse.slug, question: q, clashWith: seen.get(key)!, opener: key });
      } else {
        seen.set(key, q);
      }
    }
  }
  return out;
}

// Sentence-count targets, so the rewrites also even out the 6-7 sentence rut
// (English was 91% six-or-seven sentences). Rotated, not random.
const SENTENCE_TARGETS = [5, 8, 4, 7, 6, 9];

async function runPhaseA(lang: Lang, entries: EntryMap): Promise<void> {
  // A pass can leave a collision behind (a rewrite rejected for clashing with a
  // sibling, or a batch that introduces one), so iterate until the page openings
  // are clean. Bounded: each pass shrinks the set, and MAX_PASSES stops a
  // pathological model from looping forever.
  const MAX_PASSES = 4;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const all = findCollisions(lang, entries);
    if (!all.length) {
      console.log(`[${lang}] phase A: no collisions remain`);
      return;
    }
    const items = LIMIT ? all.slice(0, LIMIT) : all;
    console.log(`[${lang}] phase A pass ${pass}: ${items.length} colliding cell(s), batch 3`);
    await runPhaseAPass(lang, entries, items);
  }
  const left = findCollisions(lang, entries).length;
  console.log(`[${lang}] phase A stopped after ${MAX_PASSES} passes with ${left} collision(s) remaining`);
}

async function runPhaseAPass(lang: Lang, entries: EntryMap, items: CollisionItem[]): Promise<void> {

  const BATCH = 3;
  const batches: CollisionItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  const system = [
    lang === 'zh'
      ? '你正在改写 Lectio（enjoyhim.org）经文库里的默想条目，目的是消除同一页面上多条默想开头雷同的「模板感」。'
      : 'You are rewriting entries in the Lectio (enjoyhim.org) verse library to remove the templated feel of several reflections on the same page opening alike.',
    lang === 'zh' ? STANCE_ZH : STANCE_EN,
    lang === 'zh'
      ? '每条默想必须用与同页其它条目明显不同的方式开头：不要沿用相同的起句、句式或第一个词。结尾是一个读者可以驻足其上的真实问题，并以？收尾。只输出合法 json：以 slug 为键，每个值是 {"text": "..."}。'
      : 'Each reflection must open in a way clearly distinct from the others on the page: do not reuse their opening words, sentence shape, or first word. End with one real question the reader could sit with. Return valid json keyed by slug, each value {"text": "..."}.',
  ].join('\n');

  let done = 0;
  let failed = 0;
  const pending = [...batches];

  const worker = async (): Promise<void> => {
    for (;;) {
      const batch = pending.shift();
      if (!batch) return;
      const expected = new Set(batch.map((b) => b.slug));
      const user = batch
        .map((b, i) => describe(lang, { ...b, sentences: SENTENCE_TARGETS[(done + i) % SENTENCE_TARGETS.length]! }))
        .join('\n\n---\n\n');
      const prompt = `${user}\n\n${lang === 'zh' ? '请为上面每一项重写默想，用 json 输出。' : 'Rewrite each one above. Reply in json.'}`;
      try {
        const parsed = parseJson(await callModel(system, prompt));
        // Apply in sequence, re-checking against the WHOLE page after each one.
        // A batch can otherwise introduce a fresh collision between two cells
        // it rewrites at once: validating only against the original clash let
        // two rewrites land on the same new opening.
        for (const b of batch) {
          const val = parsed[b.slug] as { text?: unknown } | undefined;
          const text = typeof val?.text === 'string' ? val.text.trim() : '';
          if (text.length < (lang === 'zh' ? 120 : 350) || !/[.。?？]$/.test(text)) continue;
          if (!/^[A-Z\u4e00-\u9fa5"'“‘「]/.test(text)) continue;
          const siblings = Q_SLUGS.filter((q) => q !== b.question)
            .map((q) => entries[b.slug]?.[q]?.text)
            .filter((t): t is string => Boolean(t));
          if (siblings.some((s) => opening(s, lang) === opening(text, lang))) continue;
          entries[b.slug]![b.question]!.text = text;
        }
        done++;
        if (!DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
        console.log(`  [${lang}] A ${done}/${batches.length} (${[...expected].join(', ')})`);
      } catch (e) {
        failed++;
        console.warn(`  [${lang}] A batch failed (${[...expected].join(', ')}): ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[${lang}] pass done: ${done} ok, ${failed} failed, ${findCollisions(lang, entries).length} collision(s) remaining`);
}

// ---- phase B: closings -----------------------------------------------------

interface CloserItem { slug: string; question: string; target: string }

/**
 * Openings that are still clustered corpus-wide, independent of which question
 * they answer. The Chinese corpus leans on "想在关系里" (20 cells) because the
 * question itself is "我想在这段关系里…", so every reflection that quotes it back
 * opens the same way. Rewriting the opening sentence is the only fix; these are
 * handled like phase A but chosen by corpus frequency rather than per page.
 */
const OPENING_CLUSTER_CAP: Record<Lang, number> = { en: 10, zh: 9 };

interface OpeningItem { slug: string; question: string; opener: string; count: number }

/**
 * Greedy balancer: repeatedly move one cell out of the largest over-cap opener,
 * reassigning it to the least-used pool entry that is not its own opener. This
 * pulls the maximum down until either everything fits under the cap or the pool
 * cannot absorb more. Counts are derived from `groups` alone (single source of
 * truth), and each cell moves at most once, so it cannot ping-pong.
 */
function planClosers(lang: Lang, entries: EntryMap): CloserItem[] {
  const cap = CLOSER_CAP[lang];
  const pool = CLOSER_POOL[lang];

  // Cells grouped by the opener of their closing question.
  const groups = new Map<string, { slug: string; question: string }[]>();
  for (const verse of DECK) {
    for (const q of Q_SLUGS) {
      const text = entries[verse.slug]?.[q]?.text;
      if (!text) continue;
      const split = splitFinalQuestion(text, lang);
      if (!split) continue;
      const o = closerOpener(split.question, lang);
      if (!groups.has(o)) groups.set(o, []);
      groups.get(o)!.push({ slug: verse.slug, question: q });
    }
  }

  const size = (key: string) => groups.get(key)?.length ?? 0;
  const toRewrite: CloserItem[] = [];
  const moved = new Set<string>();
  const cellKey = (c: { slug: string; question: string }) => `${c.slug}/${c.question}`;

  // Same-page duplicates first. Two of a page's four answers ending on the same
  // question is a visible defect regardless of the corpus distribution — the
  // first phase B pass introduced exactly this and no cap-driven plan would
  // touch it, because neither opener was over its cap.
  for (const [opener, list] of groups) {
    const byPage = new Map<string, { slug: string; question: string }[]>();
    for (const c of list) {
      if (!byPage.has(c.slug)) byPage.set(c.slug, []);
      byPage.get(c.slug)!.push(c);
    }
    for (const [, pageCells] of byPage) {
      if (pageCells.length < 2) continue;
      // Keep the first, rewrite the rest.
      for (const c of pageCells.slice(1)) {
        let target: string | null = null;
        let targetSize = Infinity;
        for (const p of pool) {
          if (p === opener) continue;
          if (targetSize > size(p)) {
            targetSize = size(p);
            target = p;
          }
        }
        if (target === null) break;
        moved.add(cellKey(c));
        if (!groups.has(target)) groups.set(target, []);
        groups.get(target)!.push(c);
        toRewrite.push({ slug: c.slug, question: c.question, target });
      }
    }
  }

  const MAX_MOVES = 4000;

  for (let move = 0; move < MAX_MOVES; move++) {
    let worst: string | null = null;
    let worstCount = cap;
    for (const [o, list] of groups) {
      if (list.length > worstCount) {
        worst = o;
        worstCount = list.length;
      }
    }
    if (worst === null) break;

    // Least-used pool entry other than the group being reduced. Avoid the
    // openers already in play so the rewrite does not recreate the same skew.
    let target: string | null = null;
    let targetSize = Infinity;
    for (const p of pool) {
      if (p === worst) continue;
      if (targetSize > size(p)) {
        targetSize = size(p);
        target = p;
      }
    }
    if (target === null) break;

    // Take the last cell that has not already been moved.
    const from = groups.get(worst)!;
    let cell: { slug: string; question: string } | undefined;
    while (from.length) {
      const c = from.pop()!;
      if (!moved.has(cellKey(c))) {
        cell = c;
        break;
      }
    }
    if (!cell) continue;

    moved.add(cellKey(cell));
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target)!.push(cell);
    toRewrite.push({ slug: cell.slug, question: cell.question, target });
  }

  return toRewrite;
}

async function runPhaseB(lang: Lang, entries: EntryMap): Promise<void> {
  const all = planClosers(lang, entries);
  const items = LIMIT ? all.slice(0, LIMIT) : all;
  if (!items.length) {
    console.log(`[${lang}] phase B: nothing to do`);
    return;
  }
  console.log(`[${lang}] phase B: ${items.length} closing question(s) to rewrite, batch 6`);

  const BATCH = 6;
  const batches: CloserItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  const system = [
    lang === 'zh'
      ? '你正在改写 Lectio（enjoyhim.org）经文库默想的结尾问题，以消除句式雷同。只重写结尾的提问，正文一个字都不要动。'
      : 'You are rewriting only the closing question of Lectio (enjoyhim.org) verse-library reflections, to break up a repeated sentence pattern. Rewrite the question only; do not touch the body.',
    lang === 'zh' ? STANCE_ZH : STANCE_EN,
    lang === 'zh'
      ? '每个新问题必须以上面指定的字词开头，必须是一个读者可以驻足其上的真实问题，并以？收尾。不要使用感叹号。只输出合法 json：以 slug 为键，每个值是 {"question": "..."}。'
      : 'Each new question must begin with the specified word, must be a real question the reader could sit with, and must end with a question mark. No exclamation marks. Return valid json keyed by slug, each value {"question": "..."}.',
  ].join('\n');

  let done = 0;
  let failed = 0;
  const pending = [...batches];

  const worker = async (): Promise<void> => {
    for (;;) {
      const batch = pending.shift();
      if (!batch) return;
      const parts: string[] = [];
      for (const b of batch) {
        const entry = entries[b.slug]?.[b.question];
        if (!entry) continue;
        const split = splitFinalQuestion(entry.text, lang);
        if (!split) continue;
        parts.push(describe(lang, { slug: b.slug, question: b.question, body: split.body, opener: b.target }));
      }
      const prompt = `${parts.join('\n\n---\n\n')}\n\n${lang === 'zh' ? '请为上面每一项重写结尾问题，用 json 输出。' : 'Rewrite the closing question for each. Reply in json.'}`;
      const expected = new Set(batch.map((b) => b.slug));
      try {
        const parsed = parseJson(await callModel(system, prompt, 4, 4000));
        for (const b of batch) {
          const val = parsed[b.slug] as { question?: unknown } | undefined;
          const question = typeof val?.question === 'string' ? val.question.trim() : '';
          if (!question || !/[?\uff1f]$/.test(question)) continue;
          // The assigned opener is the point of the rewrite; a miss means the
          // distribution does not actually change. Compared case-insensitively
          // so a capitalized form still counts as the assigned opener.
          const targetOpener = closerOpener(`${b.target} 　`, lang);
          if (closerOpener(question, lang) !== targetOpener) continue;
          // A closing question must not duplicate a sibling's on the same page:
          // the first phase B pass introduced four such pairs, which a reader
          // sees immediately when the page renders all four answers.
          const siblings = Q_SLUGS.filter((q) => q !== b.question)
            .map((q) => entries[b.slug]?.[q]?.text)
            .filter((t): t is string => Boolean(t))
            .map((t) => {
              const s = splitFinalQuestion(t, lang);
              return s ? s.question.toLowerCase().replace(/\s+/g, ' ') : '';
            })
            .filter(Boolean);
          if (siblings.includes(question.toLowerCase().replace(/\s+/g, ' '))) continue;
          const entry = entries[b.slug]?.[b.question];
          if (!entry) continue;
          const split = splitFinalQuestion(entry.text, lang);
          if (!split) continue;
          // Rejoined as one paragraph, so English must be capitalized to read as
          // a new sentence rather than a continuation of the previous one.
          const joined = lang === 'zh' ? question : question.charAt(0).toUpperCase() + question.slice(1);
          entry.text = lang === 'zh' ? `${split.body}${joined}` : `${split.body} ${joined}`;
        }
        done++;
        if (!DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
        console.log(`  [${lang}] B ${done}/${batches.length}`);
      } catch (e) {
        failed++;
        console.warn(`  [${lang}] B batch failed (${[...expected].join(', ')}): ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Report the distribution after the pass.
  const after = new Map<string, number>();
  for (const verse of DECK) {
    for (const q of Q_SLUGS) {
      const text = entries[verse.slug]?.[q]?.text;
      if (!text) continue;
      const split = splitFinalQuestion(text, lang);
      if (!split) continue;
      const o = closerOpener(split.question, lang);
      after.set(o, (after.get(o) ?? 0) + 1);
    }
  }
  const top = [...after.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`[${lang}] phase B done: ${done} ok, ${failed} failed`);
  console.log(`  top closers now: ${top.map(([w, c]) => `${w}:${c}`).join('  ')}`);
}

// ---- phase D: corpus-wide opening clusters --------------------------------

function findOpeningClusters(lang: Lang, entries: EntryMap): OpeningItem[] {
  const byOpening = new Map<string, { slug: string; question: string }[]>();
  for (const verse of DECK) {
    for (const q of Q_SLUGS) {
      const text = entries[verse.slug]?.[q]?.text;
      if (!text) continue;
      const o = opening(text, lang);
      if (!byOpening.has(o)) byOpening.set(o, []);
      byOpening.get(o)!.push({ slug: verse.slug, question: q });
    }
  }
  const cap = OPENING_CLUSTER_CAP[lang];
  const out: OpeningItem[] = [];
  for (const [opener, list] of byOpening) {
    if (list.length <= cap) continue;
    // Keep the earliest cells (deck order) and rewrite the rest.
    for (const c of list.slice(cap)) out.push({ ...c, opener, count: list.length });
  }
  return out;
}

async function runPhaseD(lang: Lang, entries: EntryMap): Promise<void> {
  const all = findOpeningClusters(lang, entries);
  const items = LIMIT ? all.slice(0, LIMIT) : all;
  if (!items.length) {
    console.log(`[${lang}] phase D: no clustered openings`);
    return;
  }
  console.log(`[${lang}] phase D: ${items.length} clustered opening(s)`);

  const BATCH = 3;
  const batches: OpeningItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  const system = [
    lang === 'zh'
      ? '你正在改写 Lectio（enjoyhim.org）经文库的默想开头，目的是避免整座经文库大量条目以同样的字词起头。'
      : 'You are rewriting the opening of Lectio (enjoyhim.org) verse-library reflections so the library does not begin many entries the same way.',
    lang === 'zh' ? STANCE_ZH : STANCE_EN,
    lang === 'zh'
      ? '重写整条默想：开头必须与上面指出的重复起句明显不同，也要与同页其它条目不同。结尾是一个真实的问题，以？收尾。只输出合法 json：以 slug 为键，每个值是 {"text": "..."}。'
      : 'Rewrite the whole reflection: the opening must differ clearly from the repeated one named above, and from the other answers on the same page. End with a real question. Return valid json keyed by slug, each value {"text": "..."}.',
  ].join('\n');

  let done = 0;
  let failed = 0;
  const pending = [...batches];

  const worker = async (): Promise<void> => {
    for (;;) {
      const batch = pending.shift();
      if (!batch) return;
      const parts = batch.map((b) => {
        const base = describe(lang, { ...b, sentences: SENTENCE_TARGETS[done % SENTENCE_TARGETS.length]! });
        return lang === 'zh'
          ? `${base}\n避免以「${b.opener}」开头（该起句已出现 ${b.count} 次）。`
          : `${base}\nDo not begin with "${b.opener}" (it already appears ${b.count} times).`;
      });
      const prompt = `${parts.join('\n\n---\n\n')}\n\n${lang === 'zh' ? '请重写这些默想，用 json 输出。' : 'Rewrite these. Reply in json.'}`;
      try {
        const parsed = parseJson(await callModel(system, prompt));
        for (const b of batch) {
          const val = parsed[b.slug] as { text?: unknown } | undefined;
          const text = typeof val?.text === 'string' ? val.text.trim() : '';
          if (text.length < (lang === 'zh' ? 120 : 350) || !/[.。?？]$/.test(text)) continue;
          if (opening(text, lang) === b.opener) continue;
          const siblings = Q_SLUGS.filter((q) => q !== b.question)
            .map((q) => entries[b.slug]?.[q]?.text)
            .filter((t): t is string => Boolean(t));
          if (siblings.some((s) => opening(s, lang) === opening(text, lang))) continue;
          entries[b.slug]![b.question]!.text = text;
        }
        done++;
        if (!DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
        console.log(`  [${lang}] D ${done}/${batches.length}`);
      } catch (e) {
        failed++;
        console.warn(`  [${lang}] D batch failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[${lang}] phase D done: ${done} ok, ${failed} failed, ${findOpeningClusters(lang, entries).length} clustered cell(s) remaining`);
}

// ---- phase C: mechanical normalization ------------------------------------
// The model sometimes writes a lowercase lead-in before a question
// ("...it remains busy. before any task asks for your attention, what would...?").
// A sentence must start capitalized, and this is a mechanical fix — no model
// call is warranted. English only: Chinese has no case.

function normalizeEnglish(text: string): string {
  // Capitalize the first letter of every sentence after the first.
  return text.replace(/([.?!]\s+)([a-z])/g, (_m, punct: string, ch: string) => `${punct}${ch.toUpperCase()}`);
}

function runPhaseC(lang: Lang, entries: EntryMap): number {
  if (lang !== 'en') return 0;
  let fixed = 0;
  for (const byQuestion of Object.values(entries)) {
    for (const entry of Object.values(byQuestion)) {
      const next = normalizeEnglish(entry.text);
      if (next !== entry.text) {
        entry.text = next;
        fixed++;
      }
    }
  }
  if (fixed && !DRY) writeFileSync(pathFor(lang), `${JSON.stringify(order(entries), null, 2)}\n`, 'utf8');
  return fixed;
}

// ---- order + main ----------------------------------------------------------

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
  console.log(`endpoint ${ENDPOINT}\nmodel ${MODEL}${DRY ? '  (DRY RUN)' : ''}`);
  if (!existsSync(resolve(ROOT, 'scripts/data/interpretation-voice-worklist.json'))) {
    console.log('note: run `node scripts/audit-interpretation-voice.mjs` first for the before-numbers');
  }

  for (const lang of LANGS) {
    const entries = load(lang);
    if (PHASES.includes('a')) await runPhaseA(lang, entries);
    if (PHASES.includes('b')) await runPhaseB(lang, entries);
    if (PHASES.includes('d')) await runPhaseD(lang, entries);
    if (PHASES.includes('c')) {
      const fixed = runPhaseC(lang, entries);
      console.log(`[${lang}] phase C: capitalized ${fixed} lowercased sentence start(s)`);
    }
  }

  console.log('\nNow re-run: node scripts/audit-interpretation-voice.mjs');
}

await main();
