# Web Assistant (Site Chat) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every task that has tests.

**Goal:** Add a site-wide floating chat assistant (reading companion + spiritual chat + site guide) with metered freemium quotas, streaming replies, and per-request page/reading context.

**Architecture:** One new widget component included in `Layout.astro`; one streaming POST API + one quota GET API; two new libs (`assistant.ts` prompt/quota logic, `chatUsage.ts` D1 daily counters keyed by visitor). No chat content persisted server-side; ephemeral thread in `sessionStorage`.

**Tech Stack:** Astro 7 SSR on Cloudflare Workers (D1), `openai` npm client (`gpt-5.4-nano`, streaming), vitest + `D1Memory` helper, vanilla TS in the Astro component (no framework).

**Design doc:** `docs/superpowers/specs/2026-09-01-web-assistant-design.md`

**Conventions in this repo (already verified):**

- Libs that hit D1 take the `db` handle as a parameter (see `src/lib/users.ts`) so tests run against `src/lib/__tests__/helpers/d1-memory.ts` (`D1Memory`).
- API routes: `export const prerender = false;` + `export const POST: APIRoute = async ({ request, cookies }) => {...}` (see `src/pages/api/auth/login.ts`).
- Session: `verifySessionToken(cookieValue, env.SESSION_SECRET)` → `userId | null` (see `src/layouts/Layout.astro:15`).
- Tier: `resolveTier(userId)` from `src/lib/entitlements.ts` → `'free' | 'basic' | 'pro'`.
- OpenAI: `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at module level (see `src/lib/openai.ts:5`); model `gpt-5.4-nano`.
- Language: `lang` is `zh | en` (type from `src/lib/tarot.ts`); site default is `en` when no `lang` cookie.
- Pricing facts (from `src/pages/pricing.astro`, keep in sync): Basic $4.99/mo (annual $2.99/mo, $35.88/yr), Pro $11.99/mo (annual $7.19/mo, $86.28/yr), first month free = 30-day Stripe trial on monthly plans.

---

### Task 1: `src/lib/chatUsage.ts` — daily chat counters

**Files:**

- Create: `src/lib/chatUsage.ts`
- Test: `src/lib/__tests__/chatUsage.test.ts`

**Step 1: Write the failing test**

```ts
// src/lib/__tests__/chatUsage.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import { getChatUsage, incrementChatUsage } from '../chatUsage';

let db: D1Memory;
beforeAll(() => {
  db = new D1Memory();
});
afterAll(() => {
  db.close();
});

describe('chatUsage counters', () => {
  it('starts at zero for a fresh visitor', async () => {
    expect(await getChatUsage('u:alice', db as never)).toBe(0);
  });

  it('accumulates within the same UTC day and keeps visitors separate', async () => {
    await incrementChatUsage('u:alice', db as never);
    await incrementChatUsage('u:alice', db as never);
    await incrementChatUsage('a:1111', db as never);
    expect(await getChatUsage('u:alice', db as never)).toBe(2);
    expect(await getChatUsage('a:1111', db as never)).toBe(1);
    expect(await getChatUsage('a:2222', db as never)).toBe(0);
  });

  it('creates the schema with the expected columns', async () => {
    const cols = (db.dump('PRAGMA table_info(chat_usage_daily)') as Array<{ name: string }>)
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual(['date', 'message_count', 'visitor_key']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/chatUsage.test.ts`
Expected: FAIL — cannot resolve `../chatUsage`.

**Step 3: Write the implementation**

```ts
// src/lib/chatUsage.ts
// Daily chat-message counters, keyed by visitor (registered user or anonymous
// cookie) and UTC date. Mirrors the usage_daily pattern from usage.ts but takes
// the D1 handle explicitly so vitest can run it against D1Memory.
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS chat_usage_daily (
  visitor_key TEXT NOT NULL,
  date TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_key, date)
)`;

const initializedByDb = new WeakSet<object>();

async function ensureTable(db: D1Database): Promise<void> {
  if (initializedByDb.has(db as unknown as object)) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initializedByDb.add(db as unknown as object);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getChatUsage(visitorKey: string, db: D1Database): Promise<number> {
  await ensureTable(db);
  const row = await db
    .prepare('SELECT message_count FROM chat_usage_daily WHERE visitor_key = ? AND date = ?')
    .bind(visitorKey, todayUtc())
    .first<{ message_count: number }>();
  return row?.message_count ?? 0;
}

export async function incrementChatUsage(visitorKey: string, db: D1Database): Promise<void> {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO chat_usage_daily (visitor_key, date, message_count) VALUES (?, ?, 1)
       ON CONFLICT(visitor_key, date) DO UPDATE SET message_count = message_count + 1`
    )
    .bind(visitorKey, todayUtc())
    .run();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/chatUsage.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/chatUsage.ts src/lib/__tests__/chatUsage.test.ts
git commit -m "add daily chat usage counter lib"
```

---

### Task 2: `src/lib/assistant.ts` — quota constants, grounding facts, prompt builder

**Files:**

- Create: `src/lib/assistant.ts`
- Test: `src/lib/__tests__/assistant.test.ts`

**Step 1: Write the failing test**

```ts
// src/lib/__tests__/assistant.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANON_DAILY_MESSAGES,
  REGISTERED_DAILY_MESSAGES,
  CHAT_QUOTA,
  chatQuotaFor,
  evaluateChatQuota,
  buildGroundingFacts,
  buildSystemPrompt,
  type PageContext,
} from '../assistant';

describe('chat quota rules', () => {
  it('gives anonymous visitors 10 messages/day', () => {
    expect(chatQuotaFor({ registered: false, tier: 'free' })).toBe(ANON_DAILY_MESSAGES);
  });

  it('gives registered free users 30 and paid tiers 100', () => {
    expect(chatQuotaFor({ registered: true, tier: 'free' })).toBe(REGISTERED_DAILY_MESSAGES);
    expect(chatQuotaFor({ registered: true, tier: 'basic' })).toBe(CHAT_QUOTA.basic);
    expect(chatQuotaFor({ registered: true, tier: 'pro' })).toBe(CHAT_QUOTA.pro);
  });

  it('evaluates quota state without going negative', () => {
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 0)).toEqual({ ok: true, remaining: 10 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 9)).toEqual({ ok: true, remaining: 1 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 10)).toEqual({ ok: false, remaining: 0 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 99)).toEqual({ ok: false, remaining: 0 });
  });
});

describe('buildGroundingFacts', () => {
  it('includes plan prices and limits matching the entitlements constants', () => {
    const g = buildGroundingFacts();
    expect(g).toContain('$4.99/mo');
    expect(g).toContain('$11.99/mo');
    expect(g).toContain('30-day');
    expect(g).toContain('10 messages/day');
    expect(g).toContain('30 messages/day');
  });
});

describe('buildSystemPrompt', () => {
  it('declares the three roles, safety rails and language rule', () => {
    const p = buildSystemPrompt({ lang: 'zh', context: null, grounding: buildGroundingFacts() });
    expect(p).toContain('Reading companion');
    expect(p).toContain('Spiritual chat');
    expect(p).toContain('Site guide');
    expect(p).toContain('Chinese');
    expect(p).toContain('medical, legal or financial');
    expect(p).toContain('crisis');
  });

  it('states when no page context is available', () => {
    const p = buildSystemPrompt({ lang: 'en', context: null, grounding: '' });
    expect(p).toContain('No page context');
  });

  it('embeds page and reading context with positions, reversals and interpretations', () => {
    const ctx: PageContext = {
      path: '/',
      title: 'Inspiration Tarot',
      reading: {
        mode: 'tarot',
        spread: 'Three-Card',
        question: 'Will my move go well?',
        items: [{ name: 'The Tower', position: 'Future', reversed: true, interp: 'upheaval clears the way' }],
      },
    };
    const p = buildSystemPrompt({ lang: 'en', context: ctx, grounding: '' });
    expect(p).toContain('/  ("Inspiration Tarot")');
    expect(p).toContain('The Tower');
    expect(p).toContain('[Future]');
    expect(p).toContain('[Reversed]');
    expect(p).toContain('upheaval clears the way');
    expect(p).toContain('never invent draws');
  });

  it('marks hidden interpretations instead of pretending they exist', () => {
    const ctx: PageContext = {
      path: '/',
      title: 't',
      reading: { mode: 'bible', spread: 'Single', question: '', items: [{ name: 'Psalm 23:1', position: '', reversed: false, interp: '' }] },
    };
    const p = buildSystemPrompt({ lang: 'en', context: ctx, grounding: '' });
    expect(p).toContain('(no interpretation shown)');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/assistant.test.ts`
Expected: FAIL — cannot resolve `../assistant`.

**Step 3: Write the implementation**

```ts
// src/lib/assistant.ts
// Inspire Assistant: quota constants, grounding facts and prompt assembly.
// Design: docs/superpowers/specs/2026-09-01-web-assistant-design.md
import OpenAI from 'openai';
import type { Lang } from './tarot';
import { ANON_DAILY_DRAWS, REGISTERED_DAILY_DRAWS, QUOTA, type Tier } from './entitlements';

/** Daily chat-message limits (design section 2). */
export const ANON_DAILY_MESSAGES = 10;
export const REGISTERED_DAILY_MESSAGES = 30;
export const CHAT_QUOTA: Record<Tier, number> = { free: REGISTERED_DAILY_MESSAGES, basic: 100, pro: 100 };

export const ASSISTANT_MODEL = 'gpt-5.4-nano';
export const ASSISTANT_MAX_COMPLETION_TOKENS = 500;
/** Conversation turns sent to the model as history (server-side cap). */
export const HISTORY_TURNS_SENT = 10;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ReadingContextItem {
  /** Card name or verse reference as displayed, e.g. "The Tower (塔)". */
  name: string;
  position: string;
  reversed: boolean;
  /** Interpretation shown on the page; '' when hidden (gated draw). */
  interp: string;
}

export interface ReadingContext {
  mode: 'tarot' | 'bible';
  spread: string;
  question: string;
  items: ReadingContextItem[];
}

export interface PageContext {
  path: string;
  title: string;
  reading: ReadingContext | null;
}

export interface VisitorInfo {
  registered: boolean;
  tier: Tier;
}

export function chatQuotaFor(visitor: VisitorInfo): number {
  if (!visitor.registered) return ANON_DAILY_MESSAGES;
  return CHAT_QUOTA[visitor.tier];
}

export function evaluateChatQuota(
  visitor: VisitorInfo,
  used: number
): { ok: boolean; remaining: number } {
  const remaining = Math.max(0, chatQuotaFor(visitor) - used);
  return { ok: remaining > 0, remaining };
}

/** Site facts the site-guide role must ground on (keep in sync with /pricing). */
export function buildGroundingFacts(): string {
  return [
    'Inspiration Tarot (dramatherapy.us) plans and limits, as shown on /pricing:',
    `- Free: guests ${ANON_DAILY_DRAWS} single-card draws/day; registered users ${REGISTERED_DAILY_DRAWS}/day plus one-time trial credits (3-card x${3}, Celtic Cross x${1}).`,
    `- Basic: $4.99/mo (annual $2.99/mo, billed $35.88/yr). Single and 3-card spreads, ${QUOTA.basic} draws/day, reading history.`,
    '- Pro: $11.99/mo (annual $7.19/mo, billed $86.28/yr). All spreads, unlimited draws, reading history.',
    '- First month free: monthly plans start with a 30-day Stripe trial (payment method collected, nothing charged until the trial ends, cancel anytime, one trial per account).',
    `- Chat assistant limits: guests ${ANON_DAILY_MESSAGES} messages/day, registered free ${CHAT_QUOTA.free} messages/day, Basic and Pro ${CHAT_QUOTA.basic} messages/day.`,
    'Site pages: / (draw tarot or Bible-verse readings), /library (78-card library), /history (past readings, logged in), /pricing (plans + billing portal access), /account (plan status), /approach, /privacy.',
  ].join('\n');
}

export function buildSystemPrompt(opts: {
  lang: Lang;
  context: PageContext | null;
  grounding: string;
}): string {
  const langName = opts.lang === 'zh' ? 'Chinese' : 'English';
  const role =
    'You are the Inspire Assistant, the warm, grounded companion on the Inspiration Tarot website ' +
    '(a tarot and Bible-verse reading site for self-reflection). You serve three roles and pick per message: ' +
    '(1) Reading companion: help with the reading currently on screen - explain the drawn cards or verses, ' +
    'their positions and reversals, suggest spreads, and guide beginners through their first draw. ' +
    '(2) Spiritual chat: reflective, encouraging, non-judgmental conversation about what the visitor is going through; ' +
    'never push the product. ' +
    '(3) Site guide: answer how-to, plan and credit questions using ONLY the site facts below; ' +
    'if an answer is not covered by them, say you are not sure and point to /pricing, /account or /privacy ' +
    'instead of guessing numbers or policies.';
  const rules =
    'Rules: Reference only the cards or verses that appear in the reading context below; never invent draws. ' +
    'In Bible mode cite only the drawn verses. Never give medical, legal or financial directives; ' +
    'if someone seems to be in crisis, respond with warmth and suggest professional help or local emergency services. ' +
    'Gently deflect off-brand tangents (politics, coding help, homework) back to reflection or site topics. ' +
    'Keep replies concise (2-5 short paragraphs at most). ' +
    `Default to writing in ${langName}; if the visitor writes in another language, reply in theirs.`;
  const parts = [role, rules, `Site facts:\n${opts.grounding}`];

  if (opts.context) {
    parts.push(`Visitor is currently on ${opts.context.path} ("${opts.context.title}").`);
    const r = opts.context.reading;
    if (r) {
      let s = `Reading on screen - mode: ${r.mode}; spread: ${r.spread}; question: ${r.question || '(none)'}; drawn:`;
      for (const it of r.items) {
        s += `\n- ${it.name}${it.position ? ` [${it.position}]` : ''}${it.reversed ? ' [Reversed]' : ''}: ${it.interp || '(no interpretation shown)'}`;
      }
      parts.push(s);
    }
  } else {
    parts.push('No page context was provided for this message.');
  }
  return parts.join('\n\n');
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Streaming chat completion against the site model. */
export async function streamAssistantReply(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  return client.chat.completions.create({
    model: ASSISTANT_MODEL,
    messages,
    temperature: 0.7,
    max_completion_tokens: ASSISTANT_MAX_COMPLETION_TOKENS,
    stream: true,
  });
}
```

Note: `buildGroundingFacts` intentionally uses the live constants (`ANON_DAILY_DRAWS`, `REGISTERED_DAILY_DRAWS`, `QUOTA.basic`) so the grounding can never drift from entitlements. Prices are mirrored from `pricing.astro` — if pricing changes, update this string (the Task 2 test asserts both prices).

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/assistant.test.ts`
Expected: PASS (all).

**Step 5: Commit**

```bash
git add src/lib/assistant.ts src/lib/__tests__/assistant.test.ts
git commit -m "add assistant prompt/grounding/quota lib"
```

---

### Task 3: `POST /api/assistant/chat` — streaming endpoint with quota

**Files:**

- Create: `src/pages/api/assistant/chat.ts`
- Test: `src/lib/__tests__/assistant-api.test.ts`

**Step 1: Write the failing test**

```ts
// src/lib/__tests__/assistant-api.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const store = vi.hoisted(() => ({ db: null as unknown, create: undefined as unknown }));

vi.mock('cloudflare:workers', () => ({
  env: {
    get DB() {
      return store.db;
    },
    SESSION_SECRET: 'test-secret',
    OPENAI_API_KEY: 'test-key',
  },
}));

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: (...args: unknown[]) => store.create(...(args as [])),
      },
    };
  },
}));

vi.mock('../../lib/session', () => ({
  verifySessionToken: vi.fn(async () => store.userId ?? null),
}));

vi.mock('../../lib/entitlements', () => ({
  resolveTier: vi.fn(async () => store.tier ?? 'free'),
}));

import { POST } from '../../pages/api/assistant/chat';
import { getChatUsage, incrementChatUsage } from '../../lib/chatUsage';
import { ANON_DAILY_MESSAGES } from '../../lib/assistant';

function fakeStream() {
  return (async function* () {
    yield { choices: [{ delta: { content: 'Hello' } }] };
    yield { choices: [{ delta: { content: ' there' } }] };
  })();
}

function makeCookies(getMap: Record<string, string> = {}) {
  const setCalls: Array<{ name: string; value: string }> = [];
  return {
    setCalls,
    get: (name: string) => (getMap[name] ? { value: getMap[name] } : undefined),
    set: (name: string, value: string, _options?: Record<string, unknown>) => {
      setCalls.push({ name, value });
    },
  };
}

function makePostRequest(payload: unknown) {
  return new Request('http://localhost/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

let db: D1Memory;
beforeAll(() => {
  db = new D1Memory();
  store.db = db;
  store.userId = null;
  store.tier = 'free';
  store.create = vi.fn(async () => fakeStream());
});

afterAll(() => {
  db.close();
});

describe('POST /api/assistant/chat', () => {
  it('rejects an empty message with 400', async () => {
    const cookies = makeCookies();
    const res = await POST({ request: makePostRequest({ message: '   ' }), cookies } as never);
    expect(res.status).toBe(400);
  });

  it('streams the reply, sets an anon cookie on first use, and consumes one message', async () => {
    const cookies = makeCookies();
    const res = await POST(
      { request: makePostRequest({ message: 'hi', history: [], context: { path: '/', title: 'Home' } }), cookies } as never
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('Hello there');

    const anon = cookies.setCalls.find((c) => c.name === 'chat_anon');
    expect(anon).toBeDefined();
    expect(await getChatUsage(anon!.value, db as never)).toBe(1);
  });

  it('returns 429 quota_exceeded once the daily cap is reached (no stream)', async () => {
    const anon = 'a:cap-test';
    for (let i = 0; i < ANON_DAILY_MESSAGES; i++) await incrementChatUsage(anon, db as never);
    const cookies = makeCookies({ chat_anon: anon });
    const res = await POST({ request: makePostRequest({ message: 'hi' }), cookies } as never);
    expect(res.status).toBe(429);
    const data = (await res.json()) as { error: string; registered: boolean };
    expect(data.error).toBe('quota_exceeded');
    expect(data.registered).toBe(false);
  });

  it('does not consume quota when the model call fails', async () => {
    const anon = 'a:failure';
    store.create = vi.fn(async () => {
      throw new Error('boom');
    });
    const cookies = makeCookies({ chat_anon: anon });
    const res = await POST({ request: makePostRequest({ message: 'hi' }), cookies } as never);
    expect(res.status).toBe(502);
    expect(await getChatUsage(anon, db as never)).toBe(0);
    store.create = vi.fn(async () => fakeStream());
  });

  it('passes the system prompt and trimmed history to the model', async () => {
    const cookies = makeCookies({ chat_anon: 'a:prompt' });
    const history = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
    }));
    await POST({ request: makePostRequest({ message: 'final', history }), cookies } as never);
    const call = (store.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[0].content).toContain('Inspire Assistant');
    // system + last 10 history turns + the new user message
    expect(call.messages.length).toBe(12);
    expect(call.messages.at(-1)!.content).toBe('final');
    expect(call.messages[1].content).toBe('msg 4');
  });
});
```

Implementation note for the mock: `store` needs `userId`/`tier` fields; initialize them in the `vi.hoisted` object as `userId: null as string | null, tier: 'free' as string` — adjust the hoisted initializer accordingly:

```ts
const store = vi.hoisted(() => ({
  db: null as unknown,
  create: undefined as unknown,
  userId: null as string | null,
  tier: 'free' as string,
}));
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/assistant-api.test.ts`
Expected: FAIL — cannot resolve `../../pages/api/assistant/chat`.

**Step 3: Write the implementation**

```ts
// src/pages/api/assistant/chat.ts
// Streaming chat endpoint for the site assistant.
// Quota first, stream second: failures never consume a message.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  HISTORY_TURNS_SENT,
  buildSystemPrompt,
  buildGroundingFacts,
  evaluateChatQuota,
  streamAssistantReply,
  type ChatTurn,
  type PageContext,
} from '../../../lib/assistant';
import { getChatUsage, incrementChatUsage } from '../../../lib/chatUsage';
import { verifySessionToken } from '../../../lib/session';
import { resolveTier } from '../../../lib/entitlements';

export const prerender = false;

const ANON_COOKIE = 'chat_anon';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const MESSAGE_MAX_CHARS = 2000;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sanitizeMessage(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MESSAGE_MAX_CHARS) : '';
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const role = (t as Record<string, unknown>).role;
    const content = (t as Record<string, unknown>).content;
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      turns.push({ role, content: content.trim().slice(0, MESSAGE_MAX_CHARS) });
    }
  }
  return turns.slice(-HISTORY_TURNS_SENT);
}

function sanitizeContext(raw: unknown): PageContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const path = typeof c.path === 'string' ? c.path.slice(0, 300) : '';
  const title = typeof c.title === 'string' ? c.title.slice(0, 200) : '';
  let reading: PageContext['reading'] = null;
  const readingRaw = c.reading as Record<string, unknown> | null | undefined;
  if (readingRaw && typeof readingRaw === 'object') {
    const itemsRaw = Array.isArray(readingRaw.items) ? readingRaw.items.slice(0, 12) : [];
    reading = {
      mode: readingRaw.mode === 'bible' ? 'bible' : 'tarot',
      spread: typeof readingRaw.spread === 'string' ? readingRaw.spread.slice(0, 100) : '',
      question: typeof readingRaw.question === 'string' ? readingRaw.question.slice(0, 500) : '',
      items: itemsRaw.map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return {
          name: typeof o.name === 'string' ? o.name.slice(0, 200) : '',
          position: typeof o.position === 'string' ? o.position.slice(0, 100) : '',
          reversed: o.reversed === true,
          interp: typeof o.interp === 'string' ? o.interp.slice(0, 1000) : '',
        };
      }),
    };
  }
  if (!path && !title) return null;
  return { path, title, reading };
}

function sanitizeLang(cookies: { get(name: string): { value: string } | undefined }): 'zh' | 'en' {
  return cookies.get('lang')?.value === 'zh' ? 'zh' : 'en';
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const message = sanitizeMessage(body.message);
  if (!message) return json({ error: 'empty_message' }, 400);

  // Resolve the visitor: registered user, else anonymous cookie (created on
  // the first message - page renders never set cookies).
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

  let visitorKey: string;
  let registered: boolean;
  let tier: 'free' | 'basic' | 'pro' = 'free';
  if (userId) {
    registered = true;
    tier = await resolveTier(userId);
    visitorKey = `u:${userId}`;
  } else {
    registered = false;
    const existing = cookies.get(ANON_COOKIE)?.value;
    if (existing && /^a:[0-9a-f-]{36}$/.test(existing)) {
      visitorKey = existing;
    } else {
      visitorKey = `a:${crypto.randomUUID()}`;
      cookies.set(ANON_COOKIE, visitorKey, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: ANON_COOKIE_MAX_AGE,
      });
    }
  }

  const used = await getChatUsage(visitorKey, env.DB);
  const quota = evaluateChatQuota({ registered, tier }, used);
  if (!quota.ok) {
    return json({ error: 'quota_exceeded', registered, tier, remaining: 0 }, 429);
  }

  const system = buildSystemPrompt({
    lang: sanitizeLang(cookies),
    context: sanitizeContext(body.context),
    grounding: buildGroundingFacts(),
  });
  const history = sanitizeHistory(body.history);

  let stream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>;
  try {
    stream = await streamAssistantReply([
      { role: 'system', content: system },
      ...history.map((t) => ({ role: t.role, content: t.content }) as const),
      { role: 'user', content: message },
    ]);
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }

  const encoder = new TextEncoder();
  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        // Success: consume one message from the daily quota.
        await incrementChatUsage(visitorKey, env.DB);
        controller.close();
      } catch {
        // Mid-stream failure: deliver the partial reply; the client-side
        // retry affordance covers the truncated tail.
        controller.close();
      }
    },
  });
  return new Response(responseBody, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
```

Type note: if TS complains about the `streamAssistantReply` return type vs this local `stream` type, widen `streamAssistantReply`'s declared return type or cast at the call site (`as AsyncIterable<...>`) — do not weaken the OpenAI SDK types in `assistant.ts` itself beyond what compiles.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/assistant-api.test.ts`
Expected: PASS (5 tests).

**Step 5: Run the full suite to catch regressions**

Run: `npm test`
Expected: all suites PASS.

**Step 6: Commit**

```bash
git add src/pages/api/assistant/chat.ts src/lib/__tests__/assistant-api.test.ts
git commit -m "add streaming assistant chat endpoint with daily quota"
```

---

### Task 4: `GET /api/assistant/quota` — lazy quota lookup

**Files:**

- Create: `src/pages/api/assistant/quota.ts`
- Test: append to `src/lib/__tests__/assistant-api.test.ts`

**Step 1: Write the failing test** (append to the same file; add imports for `GET`)

```ts
import { POST, GET } from '../../pages/api/assistant/chat';
```

Instead, `quota.ts` is its own module — add a second import after creating the file:

```ts
import { GET as QUOTA_GET } from '../../pages/api/assistant/quota';

describe('GET /api/assistant/quota', () => {
  it('reports full quota for a fresh anonymous visitor (no cookie yet)', async () => {
    const res = await QUOTA_GET({ cookies: makeCookies() } as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; remaining: number; registered: boolean };
    expect(data).toEqual({ ok: true, remaining: ANON_DAILY_MESSAGES, registered: false });
  });

  it('reports remaining messages for a known anonymous visitor', async () => {
    const anon = 'a:quota-get';
    await incrementChatUsage(anon, db as never);
    const res = await QUOTA_GET({ cookies: makeCookies({ chat_anon: anon }) } as never);
    const data = (await res.json()) as { ok: boolean; remaining: number };
    expect(data.remaining).toBe(ANON_DAILY_MESSAGES - 1);
    expect(data.ok).toBe(true);
  });

  it('reports ok:false when capped', async () => {
    const anon = 'a:quota-capped';
    for (let i = 0; i < ANON_DAILY_MESSAGES; i++) await incrementChatUsage(anon, db as never);
    const res = await QUOTA_GET({ cookies: makeCookies({ chat_anon: anon }) } as never);
    const data = (await res.json()) as { ok: boolean; remaining: number };
    expect(data).toMatchObject({ ok: false, remaining: 0 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/assistant-api.test.ts`
Expected: FAIL — cannot resolve `../../pages/api/assistant/quota`.

**Step 3: Write the implementation**

```ts
// src/pages/api/assistant/quota.ts
// Lazy quota lookup: the widget fetches this only when the panel first opens.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ANON_DAILY_MESSAGES, chatQuotaFor, evaluateChatQuota } from '../../../lib/assistant';
import { getChatUsage } from '../../../lib/chatUsage';
import { verifySessionToken } from '../../../lib/session';
import { resolveTier } from '../../../lib/entitlements';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

  let registered = false;
  let tier: 'free' | 'basic' | 'pro' = 'free';
  let visitorKey = '';
  if (userId) {
    registered = true;
    tier = await resolveTier(userId);
    visitorKey = `u:${userId}`;
  } else {
    visitorKey = cookies.get('chat_anon')?.value ?? '';
  }

  const used = visitorKey ? await getChatUsage(visitorKey, env.DB) : 0;
  const visitor = { registered, tier };
  const quota = evaluateChatQuota(visitor, used);
  return new Response(
    JSON.stringify({
      ok: quota.ok,
      remaining: quota.remaining,
      limit: chatQuotaFor(visitor),
      registered,
      tier,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};
```

(First test expects exactly `{ ok, remaining, registered }` — adjust the test's `toEqual` to `toMatchObject({ ok: true, remaining: ANON_DAILY_MESSAGES, registered: false })` since the response also carries `limit` and `tier`.)

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/assistant-api.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pages/api/assistant/quota.ts src/lib/__tests__/assistant-api.test.ts
git commit -m "add assistant quota lookup endpoint"
```

---

### Task 5: `AssistantWidget.astro` + Layout include — the visible chat

**Files:**

- Create: `src/components/AssistantWidget.astro`
- Modify: `src/layouts/Layout.astro` (import + one element before `</body>`, ~line 57)

No unit tests (markup/styling); verified by dev-server run-check in Task 7.

**Step 1: Write the component**

```astro
---
// src/components/AssistantWidget.astro
// Site-wide floating chat assistant. Thread is ephemeral (sessionStorage);
// quota + replies come from /api/assistant/*.
import type { Lang } from '../lib/tarot';

interface Props {
  lang: Lang;
  loggedIn: boolean;
}
const { lang, loggedIn } = Astro.props;
const zh = lang === 'zh';
const t = {
  bubbleLabel: zh ? '打开助手' : 'Open assistant',
  title: zh ? '灵感助手' : 'Inspire Assistant',
  placeholder: zh ? '随便问点什么…' : 'Ask anything…',
  send: zh ? '发送' : 'Send',
  close: zh ? '关闭' : 'Close',
  greeting: zh
    ? '你好！我是灵感助手——可以问牌面含义、聊聊近况，或了解网站的使用方法。'
    : "Hi! I'm the Inspire Assistant — ask about your reading, talk through what's on your mind, or learn how the site works.",
  quotaTemplate: zh ? '今日剩余 {n} 条' : '{n} left today',
  cappedTitle: zh ? '今日消息已用完' : "You've used today's messages",
  cappedAnon: zh ? '注册免费账户，每天可聊 30 条。' : 'Create a free account for 30 messages a day.',
  cappedFree: zh ? '升级 Pro，每天可聊 100 条。' : 'Upgrade to Pro for 100 messages a day.',
  signup: zh ? '免费注册' : 'Sign up free',
  viewPlans: zh ? '查看方案' : 'View plans',
  error: zh ? '我暂时没能回复，请重试。' : "I couldn't respond just now. Please try again.",
  retry: zh ? '重试' : 'Retry',
  thinking: zh ? '思考中…' : 'Thinking…',
};
---
<div id="assistant-root" data-logged-in={loggedIn ? '1' : '0'} data-lang={lang}>
  <button type="button" id="assistant-bubble" aria-label={t.bubbleLabel}>✦</button>
  <section id="assistant-panel" hidden aria-label={t.title}>
    <header class="assistant-head">
      <strong>{t.title}</strong>
      <span id="assistant-quota" class="assistant-quota"></span>
      <button type="button" id="assistant-close" aria-label={t.close}>×</button>
    </header>
    <div id="assistant-thread" class="assistant-thread"></div>
    <div id="assistant-upsell" class="assistant-upsell" hidden>
      <p class="assistant-upsell-title">{t.cappedTitle}</p>
      <p id="assistant-upsell-body"></p>
      <a id="assistant-upsell-link" class="assistant-upsell-btn" href="/signup">{t.signup}</a>
    </div>
    <form id="assistant-form" class="assistant-form" autocomplete="off">
      <input id="assistant-input" type="text" placeholder={t.placeholder} maxlength="2000" />
      <button type="submit">{t.send}</button>
    </form>
  </section>
</div>

<script>
  // All strings the script needs at runtime are read from data attributes /
  // generated here, so no server round-trip is required for i18n.
  const zh = document.getElementById('assistant-root')?.getAttribute('data-lang') === 'zh';
  const T = {
    greeting: zh
      ? '你好！我是灵感助手——可以问牌面含义、聊聊近况，或了解网站的使用方法。'
      : "Hi! I'm the Inspire Assistant — ask about your reading, talk through what's on your mind, or learn how the site works.",
    quotaTemplate: zh ? '今日剩余 {n} 条' : '{n} left today',
    cappedTitle: zh ? '今日消息已用完' : "You've used today's messages",
    cappedAnon: zh ? '注册免费账户，每天可聊 30 条。' : 'Create a free account for 30 messages a day.',
    cappedFree: zh ? '升级 Pro，每天可聊 100 条。' : 'Upgrade to Pro for 100 messages a day.',
    signup: zh ? '免费注册' : 'Sign up free',
    viewPlans: zh ? '查看方案' : 'View plans',
    error: zh ? '我暂时没能回复，请重试。' : "I couldn't respond just now. Please try again.",
    retry: zh ? '重试' : 'Retry',
    thinking: zh ? '思考中…' : 'Thinking…',
  };
  const CHIPS: Record<string, string[]> = zh
    ? {
        '/pricing': ['Pro 包含什么？', '首月免费是怎么运作的？', '可以随时取消吗？'],
        '/library': ['「高塔」这张牌是什么意思？', '哪张牌代表新的开始？', '逆位是什么意思？'],
        '/': ['一次解读是怎么进行的？', '帮我抽一张牌', '你可以帮我做什么？'],
      }
    : {
        '/pricing': ["What's in Pro?", 'How does the free trial work?', 'Can I cancel anytime?'],
        '/library': ['What does The Tower mean?', 'Which card means new beginnings?', 'How do reversals work?'],
        '/': ['How does a reading work?', 'Draw a card for me', 'What can you help with?'],
      };
  const DEFAULT_CHIPS = zh
    ? ['你能帮我做什么？', '每日抽牌次数是怎么算的？', '我过去的解读在哪里看？']
    : ['What can you help with?', 'How do daily draws work?', 'Where are my past readings?'];

  const HISTORY_SENT = 10;
  const THREAD_KEPT = 20;
  const STORE_KEY = 'inspire-chat-thread';

  const bubble = document.getElementById('assistant-bubble') as HTMLButtonElement;
  const panel = document.getElementById('assistant-panel') as HTMLElement;
  const closeBtn = document.getElementById('assistant-close') as HTMLButtonElement;
  const threadEl = document.getElementById('assistant-thread') as HTMLElement;
  const form = document.getElementById('assistant-form') as HTMLFormElement;
  const input = document.getElementById('assistant-input') as HTMLInputElement;
  const quotaEl = document.getElementById('assistant-quota') as HTMLElement;
  const upsellEl = document.getElementById('assistant-upsell') as HTMLElement;
  const upsellBody = document.getElementById('assistant-upsell-body') as HTMLElement;
  const upsellLink = document.getElementById('assistant-upsell-link') as HTMLAnchorElement;

  interface Turn { role: 'user' | 'assistant'; content: string }
  let thread: Turn[] = [];
  try {
    thread = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]') as Turn[];
    thread = thread.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
  } catch { thread = []; }
  let capped = false;
  let busy = false;
  let quotaLoaded = false;

  const save = () => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(thread.slice(-THREAD_KEPT))); } catch { /* ignore */ }
  };
  const scroll = () => { threadEl.scrollTop = threadEl.scrollHeight; };

  function bubbleEl(role: 'user' | 'assistant' | 'error', content: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `assistant-msg assistant-msg-${role}`;
    el.textContent = content;
    threadEl.appendChild(el);
    scroll();
    return el;
  }

  function addChips() {
    const chips = CHIPS[location.pathname] ?? DEFAULT_CHIPS;
    const row = document.createElement('div');
    row.className = 'assistant-chips';
    for (const text of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => { row.remove(); void send(text); });
      row.appendChild(b);
    }
    threadEl.appendChild(row);
  }

  function buildContext(): { path: string; title: string; reading: unknown } {
    const ctx: { path: string; title: string; reading: unknown } = {
      path: location.pathname,
      title: document.title,
      reading: null,
    };
    const el = document.getElementById('inspire-reading-context');
    if (el) {
      try { ctx.reading = JSON.parse(el.textContent ?? 'null'); } catch { ctx.reading = null; }
    }
    return ctx;
  }

  function showUpsell(data: { registered?: boolean; tier?: string }) {
    capped = true;
    upsellEl.hidden = false;
    if (data.registered) {
      upsellBody.textContent = T.cappedFree;
      upsellLink.textContent = T.viewPlans;
      upsellLink.href = '/pricing';
    } else {
      upsellBody.textContent = T.cappedAnon;
      upsellLink.textContent = T.signup;
      upsellLink.href = `/signup?next=${encodeURIComponent(location.pathname)}`;
    }
    quotaEl.textContent = T.quotaTemplate.replace('{n}', '0');
  }

  async function refreshQuota() {
    try {
      const res = await fetch('/api/assistant/quota');
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; remaining: number; registered: boolean };
      quotaEl.textContent = T.quotaTemplate.replace('{n}', String(data.remaining));
      if (!data.ok) showUpsell(data);
    } catch { /* quota display is best-effort */ }
  }

  function addErrorBubble(failedText: string) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-msg assistant-msg-error';
    const span = document.createElement('span');
    span.textContent = T.error;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = T.retry;
    btn.addEventListener('click', () => { wrap.remove(); void send(failedText); });
    wrap.append(span, btn);
    threadEl.appendChild(wrap);
    scroll();
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || capped || busy) return;
    busy = true;
    input.value = '';
    bubbleEl('user', clean);
    thread.push({ role: 'user', content: clean });

    const thinking = document.createElement('div');
    thinking.className = 'assistant-msg assistant-msg-thinking';
    thinking.textContent = T.thinking;
    threadEl.appendChild(thinking);
    scroll();

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          history: thread.slice(0, -1).slice(-HISTORY_SENT),
          context: buildContext(),
        }),
      });

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { registered?: boolean; tier?: string };
        thinking.remove();
        thread.pop(); // not answered - allow resending after upgrade/reset
        input.value = clean; // keep the typed message for a retry
        showUpsell(data);
        return;
      }
      if (!res.ok || !res.body) {
        thinking.remove();
        thread.pop();
        addErrorBubble(clean);
        return;
      }

      thinking.remove();
      const el = bubbleEl('assistant', '');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        el.textContent = full;
        scroll();
      }
      thread.push({ role: 'assistant', content: full });
      save();
      void refreshQuota();
    } catch {
      thinking.remove();
      thread.pop();
      addErrorBubble(clean);
    } finally {
      busy = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send(input.value);
  });

  function openPanel() {
    panel.hidden = false;
    bubble.hidden = true;
    if (thread.length === 0) {
      bubbleEl('assistant', T.greeting);
      addChips();
    } else {
      for (const t of thread) bubbleEl(t.role, t.content);
    }
    if (!quotaLoaded) {
      quotaLoaded = true;
      void refreshQuota();
    }
    input.focus();
  }
  function closePanel() {
    panel.hidden = true;
    bubble.hidden = false;
  }

  bubble.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });
</script>

<style>
  #assistant-root { position: fixed; right: 18px; bottom: 18px; z-index: 9999; }
  #assistant-bubble {
    width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
    font-size: 22px; color: #fff; background: linear-gradient(135deg, #5b4b8a, #2e2654);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); transition: transform 0.15s ease;
  }
  #assistant-bubble:hover { transform: scale(1.06); }
  #assistant-panel {
    width: min(380px, calc(100vw - 24px)); max-height: 70dvh;
    display: flex; flex-direction: column;
    background: #fff; color: #222; border-radius: 14px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.25);
    overflow: hidden; animation: assistant-rise 0.18s ease;
  }
  @keyframes assistant-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    #assistant-panel, #assistant-bubble { animation: none; transition: none; }
  }
  .assistant-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; background: #2e2654; color: #fff;
  }
  .assistant-head strong { flex: 0 0 auto; }
  .assistant-quota { flex: 1; text-align: right; font-size: 12px; opacity: 0.85; }
  #assistant-close { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; }
  .assistant-thread { flex: 1 1 auto; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .assistant-msg { max-width: 85%; padding: 8px 11px; border-radius: 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .assistant-msg-user { align-self: flex-end; background: #5b4b8a; color: #fff; }
  .assistant-msg-assistant { align-self: flex-start; background: #f1eef9; color: #222; }
  .assistant-msg-error { align-self: flex-start; background: #fdecea; color: #7a2b23; display: flex; gap: 8px; align-items: center; }
  .assistant-msg-error button { border: 1px solid #7a2b23; background: none; color: #7a2b23; border-radius: 8px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
  .assistant-msg-thinking { align-self: flex-start; background: #f1eef9; color: #666; font-style: italic; }
  .assistant-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .assistant-chips button {
    border: 1px solid #5b4b8a; background: #fff; color: #5b4b8a;
    border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer;
  }
  .assistant-chips button:hover { background: #f1eef9; }
  .assistant-upsell { padding: 10px 12px; background: #fdf7e8; border-top: 1px solid #e8d9a8; font-size: 13px; }
  .assistant-upsell-title { font-weight: 600; margin: 0 0 4px; }
  .assistant-upsell-btn {
    display: inline-block; margin-top: 8px; padding: 6px 12px; border-radius: 8px;
    background: #5b4b8a; color: #fff; text-decoration: none; font-size: 13px;
  }
  .assistant-form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(0, 0, 0, 0.08); }
  .assistant-form input {
    flex: 1; border: 1px solid rgba(0, 0, 0, 0.18); border-radius: 10px;
    padding: 8px 10px; font-size: 14px;
  }
  .assistant-form button {
    border: none; border-radius: 10px; padding: 8px 14px; cursor: pointer;
    background: #5b4b8a; color: #fff; font-size: 14px;
  }
</style>
```

**Step 2: Include it in the layout**

In `src/layouts/Layout.astro`:

1. Add to the imports at the top (after the `langSwitchHref` import):

```astro
import AssistantWidget from '../components/AssistantWidget.astro';
```

2. Add the widget just before `</body>` (after `<slot />`):

```astro
  <AssistantWidget lang={lang} loggedIn={!!userId} />
```

`userId` is already resolved at the top of the layout frontmatter, and `lang` is a prop — no new server work per request.

**Step 3: Verify in the dev server**

Run: `npm run dev` (in a second terminal, keep it running)

Check manually at `http://localhost:4321/`:

- Bubble visible bottom-right on every page (`/`, `/pricing`, `/library`).
- Panel opens, greeting + 3 starter chips appear; chips differ on `/pricing` vs `/`.
- Sending "hello" streams a reply; quota line shows "9 left today" (en) — one consumed.
- Reload keeps the thread (sessionStorage); close-tab clears it.
- `zh` (`?lang=zh`): UI strings and greeting are Chinese; reply comes back in Chinese for a Chinese message.

Stop the dev server when done.

**Step 4: Commit**

```bash
git add src/components/AssistantWidget.astro src/layouts/Layout.astro
git commit -m "add site-wide assistant chat widget"
```

---

### Task 6: Reading context — `index.astro` publishes the on-screen spread

**Files:**

- Modify: `src/pages/index.astro` (frontmatter helper + one tag in the results markup)

**Step 1: Add the context builder to the frontmatter**

In `src/pages/index.astro`, after the existing variable setup (near the other derived state, after `mode` is final — e.g. right before the HTML section), add:

```ts
// Assistant widget context: what reading is currently on screen (design:
// docs/superpowers/specs/2026-09-01-web-assistant-design.md, section 3).
// Hidden interpretations (gated draws) are passed as '' - the assistant is
// instructed not to invent them.
const hasReading = !!(cards || verses);
const assistantReading = hasReading
  ? {
      mode,
      spread: (mode === 'bible' ? BIBLE_SPREADS[spreadKey] : SPREADS[spreadKey])?.name?.[lang] ?? spreadKey,
      question: isDefaultQuestion ? '' : question,
      items: (mode === 'bible' ? verses ?? [] : cards ?? []).map((c) =>
        'refEn' in c
          ? { name: `${c.refEn} (${c.refZh})`, position: c.position ?? '', reversed: false, interp: c.interp_text ?? '' }
          : { name: `${c.en} (${c.zh})`, position: c.position ?? '', reversed: c.reversed === true, interp: c.interp_text ?? '' }
      ),
    }
  : null;
const assistantContextJson = JSON.stringify(assistantReading).replace(/</g, '\\u003c');
```

**Step 2: Render the JSON tag inside the results markup**

In the same file's markup, wherever the completed reading is rendered (the block that shows `interpretation` with the card grid / bible page), add the context tag **inside that conditional block**, e.g. immediately after the opening of the results section:

```astro
{assistantReading && (
  <script type="application/json" id="inspire-reading-context" set:html={assistantContextJson} />
)}
```

Anchor to look for: the markup branch gated on a revealed reading (where `cards.map(...)`/`verses.map(...)` render with `interp_text`). Do not render it on the fresh-draw form state.

**Step 3: Verify in the dev server**

Run: `npm run dev`

- Draw a single card (question or default): view source → `#inspire-reading-context` exists with `mode`, `spread`, `question`, and one item with name/position/reversed/interp.
- Bible mode draw: item names are verse references (`refEn`), `reversed` absent/false.
- Anonymous 3-card draw (gated, uninterpreted): items present with `interp: ''` — the assistant must answer about card meanings generically without pretending an interpretation exists.
- Home page without a drawn reading: the tag must NOT exist.
- Widget check: on a completed reading, ask "what does the drawn card mean?" — the reply must reference the actual card.

**Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "publish on-screen reading context for the assistant"
```

---

### Task 7: Full verification + docs

**Files:**

- Modify: `README.md` (Features list — one bullet)
- Create: `docs/web-assistant-run-check.md` (manual verification evidence, pattern of `docs/google-login-run-check-report.md`)

**Step 1: Run the whole test suite**

Run: `npm test`
Expected: all PASS, including the three new suites (`chatUsage`, `assistant`, `assistant-api`).

**Step 2: Typecheck and build**

Run: `npx astro check` then `npm run build`
Expected: no type errors; build succeeds (prebuild regenerates the sitemap).

**Step 3: Manual run-check** (dev server, both languages) — record results in `docs/web-assistant-run-check.md`:

1. Anonymous: chat 10 messages → 11th shows the upsell card with `/signup?next=…`; signup → quota becomes 30/day (verify via `/api/assistant/quota`).
2. Reading context: on a finished tarot draw ask "explain the reversed card" — answer names the actual card; Bible mode: cites only drawn verses.
3. Pricing page: "What's in Pro?" — answer matches grounding facts ($11.99/mo, all spreads, unlimited draws).
4. Error path: temporarily break `OPENAI_API_KEY` (`.dev.vars`) → honest failure message, quota unchanged (`/api/assistant/quota` before/after).
5. Mobile viewport (375px): panel fits, input usable. `prefers-reduced-motion`: no panel animation.
6. zh + en: UI strings and replies follow site language; mixed-language user message answered in kind.

**Step 4: Update README**

Add to the Features list:

```markdown
- **Web assistant**: a floating chat assistant on every page - reading companion (explains the cards/verses on screen), spiritual chat, and site guide grounded in real plan facts. Metered freemium: anonymous 10 messages/day, registered free 30/day, Basic/Pro 100/day; conversations are ephemeral (browser-only, nothing stored server-side). Details: `docs/superpowers/specs/2026-09-01-web-assistant-design.md`.
```

**Step 5: Commit**

```bash
git add README.md docs/web-assistant-run-check.md
git commit -m "document web assistant feature and run-check results"
```

---

## Verification-before-completion checklist (superpowers:verification-before-completion)

- [ ] `npm test` — full suite green
- [ ] `npx astro check` — no type errors
- [ ] `npm run build` — succeeds
- [ ] Run-check doc filled with real observations (not "should work")
- [ ] `git log` shows one commit per task with focused messages
