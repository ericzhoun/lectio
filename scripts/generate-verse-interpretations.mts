// Generate the pre-written per-question interpretations for the verse library.
//
// Where the reading flow runs question -> verse, /library/<slug> runs the other
// way: a visitor arrives from a question-shaped search, so each verse page
// carries its own interpretation for each of the typical questions in
// src/lib/verseQuestions.ts.
//
// Run:  npx tsx scripts/generate-verse-interpretations.mts [flags]
//   --langs=en,zh        languages to fill (default both)
//   --questions=a,b      question slugs to fill (default all)
//   --verses=slug,slug   restrict to these verse slugs (default whole deck)
//   --batch=6            verses per model call
//   --concurrency=4      calls in flight
//   --force              regenerate entries that already exist
//
// Resumable: entries already present in the target JSON are kept unless
// --force, so an interrupted run is continued by running it again. The file is
// rewritten after every completed batch rather than at the end.
//
// The model endpoint is the local opencodex proxy (openai-compatible). It is
// reached over loopback and needs no API key; it is not used at runtime by the
// app, only by this authoring step. Override with OCX_ENDPOINT / OCX_MODEL.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLibraryVerses } from '../src/lib/scripture';
import { TYPICAL_QUESTIONS } from '../src/lib/verseQuestions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ENDPOINT = process.env.OCX_ENDPOINT ?? 'http://127.0.0.1:10100/v1/chat/completions';
const MODEL = process.env.OCX_MODEL ?? 'gpt-6.1-sol--fast';
const TEMPERATURE = Number(process.env.OCX_TEMPERATURE ?? 0.85);

type Lang = 'en' | 'zh';

/** One interpretation: the reflection, plus the line worth carrying away. */
interface Interpretation {
  text: string;
  carry: string;
}
type EntryMap = Record<string, Record<string, Interpretation>>;

// ---- flags -----------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string, fallback: string | null = null): string | null {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? 'true' : hit.slice(eq + 1);
}

const LANGS = (flag('langs', 'en,zh') as string).split(',').filter((l): l is Lang => l === 'en' || l === 'zh');
const QUESTION_FILTER = flag('questions');
const VERSE_FILTER = flag('verses');
const BATCH = Math.max(1, Number(flag('batch', '6')));
const CONCURRENCY = Math.max(1, Number(flag('concurrency', '4')));
const FORCE = flag('force') === 'true';

const pathFor = (lang: Lang) => resolve(ROOT, `src/lib/verseInterpretations.${lang}.json`);

function loadEntries(lang: Lang): EntryMap {
  const path = pathFor(lang);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as EntryMap;
}

// ---- what the app already believes ----------------------------------------
// Carried into the prompt so generated prose matches the site's stated stance
// (see README, /approach, and the system prompt in src/lib/openai.ts): a
// passage is an occasion to meet God, never God's chosen answer telling the
// reader what to do, and never a prediction.

const VOICE_RULES_EN = [
  'Lectio is contemplative reading, not divination. The passage is an occasion to meet God through Scripture, never a claim that God chose it to tell the reader what to do, and never a prediction of what will happen.',
  'Never promise an outcome, never predict the future, never tell the reader what God is doing or will do in their circumstances. Speak of what the passage says and what it invites.',
  'Do not cite or invent any Bible reference other than the passage given.',
  'If the passage genuinely does not address the question directly, say so honestly in one clause and then draw out what the passage does offer that is still true for someone asking it. Never force a false connection.',
  'Tone: warm, plain, unhurried, second person ("you"). Contemplative, not preachy; encouraging, not sentimental. No exclamation marks, no emoji, no rhetorical flourishes, no "in conclusion".',
  'Open each entry differently from the others in the batch: vary the first words so no two entries share a formula.',
];

const VOICE_RULES_ZH = [
  'Lectio 是默观式的读经，不是占卜。经文是藉着圣经与神相遇的契机，绝不宣称神特别拣选这节经文来告诉读者该怎么做，也绝不预言将来的事。',
  '不要许诺结果，不要预言未来，不要替神宣告他正在或将要为读者做什么。只谈这段经文说了什么，以及它邀请人如何回应。',
  '除了所给的经文之外，不要引用或杜撰任何其他圣经出处。',
  '如果这段经文确实没有直接回应这个问题，就用一句话诚实说明，然后带出它对这样发问的人仍然真实的部分。绝不可勉强牵合。',
  '语气：温和、平实、从容，用「你」称呼读者。默想而非说教；鼓励而非煽情。不用感叹号，不用表情符号，不要「总而言之」这类套话。',
  '同一批里每一条的开头都要不一样，避免所有条目用同一个句式起头。',
];

const SHAPE_EN =
  'Return valid json only, an object keyed by verse slug, each value an object with exactly two string fields: ' +
  '"text" (the reflection, 90-130 words, ending with one real question the reader could sit with) and ' +
  '"carry" (one short line of 6-14 words worth carrying into the day; a sentence, not a command).';

const SHAPE_ZH =
  '只输出合法的 json：以经文 slug 为键的对象，每个值是一个对象，恰好包含两个字符串字段：' +
  '"text"（默想正文，180-260 个汉字，结尾是一个读者可以驻足其上的真实问题）与 ' +
  '"carry"（一句 12-24 字的短句，值得带进一天；是陈述，不是命令）。';

function buildSystemPrompt(lang: Lang): string {
  const rules = lang === 'zh' ? VOICE_RULES_ZH : VOICE_RULES_EN;
  const shape = lang === 'zh' ? SHAPE_ZH : SHAPE_EN;
  const head = lang === 'zh'
    ? '你正在为 Lectio（enjoyhim.org）的经文库撰写「常见问题的默想」。读者往往从搜索一个真实问题而来，落在这节经文的页面上，因此每个问题都要给出这节经文自己的默想。'
    : 'You are writing the pre-built reflections for the Lectio (enjoyhim.org) verse library. Readers often arrive on a verse page from a search for a real question, so each listed question needs this passage\'s own reflection.';
  return [head, ...rules.map((r) => `- ${r}`), shape].join('\n');
}

// Few-shot examples are drawn from the file itself (the hand-written seeds),
// so the model imitates the established voice rather than inventing one.
function fewShot(lang: Lang, entries: EntryMap, exclude: Set<string>): string {
  const pairs: string[] = [];
  for (const [slug, byQuestion] of Object.entries(entries)) {
    if (pairs.length >= 2) break;
    if (exclude.has(slug)) continue;
    const [questionSlug, value] = Object.entries(byQuestion)[0] ?? [];
    if (!questionSlug || !value?.text) continue;
    const q = TYPICAL_QUESTIONS.find((t) => t.slug === questionSlug);
    const verse = getLibraryVerses().find((v) => v.slug === slug);
    if (!q || !verse) continue;
    const question = lang === 'zh' ? q.questionZh : q.questionEn;
    const ref = lang === 'zh' ? verse.refZh : verse.refEn;
    const theme = lang === 'zh' ? verse.themeZh : verse.themeEn;
    pairs.push(
      `Example input: slug ${slug}; passage ${ref}; theme ${theme}; question "${question}"\n` +
      `Example output json for it: ${JSON.stringify({ [slug]: value })}`
    );
  }
  return pairs.join('\n\n');
}

function buildUserPrompt(lang: Lang, questionSlug: string, verses: typeof DECK, entries: EntryMap): string {
  const q = TYPICAL_QUESTIONS.find((t) => t.slug === questionSlug);
  if (!q) throw new Error(`unknown question slug: ${questionSlug}`);
  const question = lang === 'zh' ? q.questionZh : q.questionEn;
  const lines: string[] = [];
  lines.push(lang === 'zh' ? `读者的问题：「${question}」` : `The reader's question: "${question}"`);
  lines.push('');
  lines.push(lang === 'zh' ? '为以下每一节经文写一条默想（用中文）：' : 'Write one reflection for each of these passages:');
  for (const v of verses) {
    if (lang === 'zh') {
      lines.push(`- slug ${v.slug}; 经文 ${v.refZh}（${v.refEn}）; 主题 ${v.themeZh}; 原文：「${v.textZh}」`);
    } else {
      lines.push(`- slug ${v.slug}; passage ${v.refEn} (${v.refZh}); theme ${v.themeEn}; text: "${v.textEn}"`);
    }
  }
  const shots = fewShot(lang, entries, new Set(verses.map((v) => v.slug)));
  if (shots) {
    lines.push('');
    lines.push(lang === 'zh' ? '风格示例（仅供模仿语气与结构）：' : 'Style examples (imitate the voice and shape only):');
    lines.push(shots);
  }
  lines.push('');
  lines.push(lang === 'zh'
    ? `请用 json 输出，恰好包含 ${verses.length} 个键。`
    : `Reply in json with exactly ${verses.length} keys.`);
  return lines.join('\n');
}

// ---- model call ------------------------------------------------------------

const DECK = getLibraryVerses();

async function callModel(system: string, user: string, attempts = 4): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: TEMPERATURE,
          max_completion_tokens: 16000,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('response truncated (finish_reason=length)');
      const content = choice?.message?.content ?? '';
      if (!content.trim()) throw new Error('empty response');
      return content;
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`model call failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : lastError}`);
}

// ---- validation ------------------------------------------------------------
// Length floors catch truncated or padded answers; the rest catches empty and
// non-string fields. Deliberately loose: the reviewer pass judges quality, this
// only guarantees the page never renders an empty block.

function valid(lang: Lang, value: unknown): value is Interpretation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || typeof v.carry !== 'string') return false;
  const text = v.text.trim();
  const carry = v.carry.trim();
  const minText = lang === 'zh' ? 120 : 350;
  const maxText = lang === 'zh' ? 900 : 1600;
  if (text.length < minText || text.length > maxText) return false;
  if (carry.length < 8 || carry.length > 140) return false;
  return text.endsWith('?') || text.endsWith('？') || /[.。]$/.test(text);
}

/** Pull `{ slug: { text, carry } }` out of a model reply, tolerating wrappers. */
function parseReply(raw: string, expected: Set<string>): Record<string, Interpretation> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('reply was not json');
    data = JSON.parse(match[0]);
  }
  // Unwrap common one-level nesting ({ interpretations: {...} }).
  if (data && typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 1 && !expected.has(keys[0]!) && typeof (data as Record<string, unknown>)[keys[0]!] === 'object') {
      const inner = (data as Record<string, Record<string, unknown>>)[keys[0]!]!;
      if (Object.keys(inner).some((k) => expected.has(k))) data = inner;
    }
  }
  const out: Record<string, Interpretation> = {};
  for (const [slug, value] of Object.entries(data as Record<string, unknown>)) {
    if (expected.has(slug)) out[slug] = value as Interpretation;
  }
  return out;
}

// ---- run -------------------------------------------------------------------

function save(lang: Lang, entries: EntryMap): void {
  // Stable key order (deck order, then question order) so diffs stay readable
  // across resumable runs.
  const ordered: EntryMap = {};
  for (const v of DECK) {
    const byQuestion = entries[v.slug];
    if (!byQuestion) continue;
    const qOrdered: Record<string, Interpretation> = {};
    for (const q of TYPICAL_QUESTIONS) {
      if (byQuestion[q.slug]) qOrdered[q.slug] = byQuestion[q.slug]!;
    }
    if (Object.keys(qOrdered).length) ordered[v.slug] = qOrdered;
  }
  writeFileSync(pathFor(lang), `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

function coverage(entries: EntryMap, langs: Lang[]): void {
  for (const lang of langs) {
    const e = loadEntries(lang);
    let have = 0;
    for (const v of DECK) for (const q of TYPICAL_QUESTIONS) if (e[v.slug]?.[q.slug]) have++;
    const total = DECK.length * TYPICAL_QUESTIONS.length;
    console.log(`  ${lang}: ${have}/${total} entries`);
  }
}

async function generateLanguage(lang: Lang): Promise<void> {
  const entries = loadEntries(lang);
  const system = buildSystemPrompt(lang);
  const questions = TYPICAL_QUESTIONS.filter((q) => !QUESTION_FILTER || QUESTION_FILTER.split(',').includes(q.slug));
  const verses = VERSE_FILTER
    ? DECK.filter((v) => VERSE_FILTER.split(',').includes(v.slug))
    : DECK;

  // Build the work list: (question, batch of verses still missing an entry).
  const jobs: { questionSlug: string; verses: typeof DECK }[] = [];
  for (const q of questions) {
    const missing = verses.filter((v) => FORCE || !valid(lang, entries[v.slug]?.[q.slug]));
    for (let i = 0; i < missing.length; i += BATCH) {
      jobs.push({ questionSlug: q.slug, verses: missing.slice(i, i + BATCH) });
    }
  }

  console.log(`[${lang}] ${jobs.length} batch(es), model ${MODEL}, batch ${BATCH}, concurrency ${CONCURRENCY}`);
  let done = 0;
  let failed = 0;
  const pending = [...jobs];

  const worker = async (): Promise<void> => {
    for (;;) {
      const job = pending.shift();
      if (!job) return;
      const expected = new Set(job.verses.map((v) => v.slug));
      try {
        const raw = await callModel(system, buildUserPrompt(lang, job.questionSlug, job.verses, entries));
        const parsed = parseReply(raw, expected);
        const got: string[] = [];
        for (const slug of expected) {
          const value = parsed[slug];
          if (!valid(lang, value)) continue;
          entries[slug] = { ...(entries[slug] ?? {}), [job.questionSlug]: { text: value.text.trim(), carry: value.carry.trim() } };
          got.push(slug);
        }
        done++;
        save(lang, entries);
        const short = [...expected].filter((s) => !got.includes(s));
        console.log(
          `[${lang}] ${done}/${jobs.length} ${job.questionSlug} +${got.length}${short.length ? ` MISSING ${short.join(',')}` : ''}`
        );
        // Anything the model skipped or padded is retried once on its own, so a
        // lax batch never leaves a hole in the page.
        if (short.length) {
          const retryVerses = job.verses.filter((v) => short.includes(v.slug));
          try {
            const raw2 = await callModel(system, buildUserPrompt(lang, job.questionSlug, retryVerses, entries));
            const parsed2 = parseReply(raw2, new Set(short));
            for (const slug of short) {
              const value = parsed2[slug];
              if (!valid(lang, value)) continue;
              entries[slug] = { ...(entries[slug] ?? {}), [job.questionSlug]: { text: value.text.trim(), carry: value.carry.trim() } };
            }
            save(lang, entries);
          } catch (e) {
            console.warn(`[${lang}] retry failed for ${short.join(',')}: ${e instanceof Error ? e.message : e}`);
          }
        }
      } catch (e) {
        failed++;
        console.error(`[${lang}] batch failed (${job.questionSlug} × ${[...expected].join(',')}): ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[${lang}] finished: ${done} batch(es) ok, ${failed} failed`);
}

async function main(): Promise<void> {
  console.log(`endpoint ${ENDPOINT}\nmodel ${MODEL}`);
  for (const lang of LANGS) {
    await generateLanguage(lang);
    // Re-read from disk so the coverage line reflects what was written.
    const e = loadEntries(lang);
    let have = 0;
    for (const v of DECK) for (const q of TYPICAL_QUESTIONS) if (e[v.slug]?.[q.slug]) have++;
    console.log(`[${lang}] coverage ${have}/${DECK.length * TYPICAL_QUESTIONS.length}`);
  }
  console.log('coverage:');
  coverage({}, LANGS);
  console.log('\nNext: node scripts/check-verse-interpretations.mjs');
}

await main();
