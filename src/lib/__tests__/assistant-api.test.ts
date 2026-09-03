// src/lib/__tests__/assistant-api.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const store = vi.hoisted(() => ({
  db: null as unknown,
  create: undefined as unknown,
  userId: null as string | null,
  tier: 'free' as string,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    get DB() {
      return store.db;
    },
    SESSION_SECRET: '***',
    OPENAI_API_KEY: '***',
  },
}));

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: (...args: unknown[]) =>
          (store.create as (...args: unknown[]) => unknown)(...args),
      },
    };
  },
}));

vi.mock('../../lib/session', () => ({
  verifySessionToken: vi.fn(async () => store.userId ?? null),
}));

vi.mock('../../lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/entitlements')>()),
  resolveTier: vi.fn(async () => store.tier ?? 'free'),
}));

import { POST } from '../../pages/api/assistant/chat';
import { GET as QUOTA_GET } from '../../pages/api/assistant/quota';
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

beforeEach(() => {
  // Fresh default stream mock per test so per-test overrides never leak.
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
  });

  it('consumes quota on first chunk even when the upstream stream dies mid-way', async () => {
    const anon = 'a:mid-stream';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.create = vi.fn(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        throw new Error('stream died');
      })()
    );
    try {
      const cookies = makeCookies({ chat_anon: anon });
      const res = await POST({ request: makePostRequest({ message: 'hi' }), cookies } as never);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Hello');
      expect(await getChatUsage(anon, db as never)).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith('assistant stream error:', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
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

describe('GET /api/assistant/quota', () => {
  it('reports full quota for a fresh anonymous visitor (no cookie yet)', async () => {
    const res = await QUOTA_GET({ cookies: makeCookies() } as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; remaining: number; registered: boolean };
    expect(data).toMatchObject({ ok: true, remaining: ANON_DAILY_MESSAGES, registered: false });
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
