// src/lib/__tests__/roblox-api.test.ts
// /api/roblox/* — the server-to-server integration for the Roblox world.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const store = vi.hoisted(() => ({
  db: null as unknown,
  apiKey: 'test-roblox-key' as string | null,
  create: undefined as unknown,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    get DB() {
      return store.db;
    },
    get ROBLOX_API_KEY() {
      return store.apiKey;
    },
    SESSION_SECRET: '***',
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

import { POST as STATE_POST } from '../../pages/api/roblox/state';
import { POST as REGISTER_POST } from '../../pages/api/roblox/register';
import { POST as EXPLORE_POST } from '../../pages/api/roblox/explore';
import { POST as TODAY_POST } from '../../pages/api/roblox/today';
import { POST as ASSISTANT_POST } from '../../pages/api/roblox/assistant';
import { POST as LIBRARY_POST } from '../../pages/api/roblox/library';
import { keysMatch } from '../../lib/roblox';
import { getTodayUsage, incrementUsage } from '../../lib/usage';
import { getChatUsage, incrementChatUsage } from '../../lib/chatUsage';
import { getCreditBalance } from '../../lib/credits';
import { ANON_DAILY_MESSAGES } from '../../lib/assistant';
import { ANON_DAILY_DRAWS } from '../../lib/entitlements';

function request(path: string, payload: unknown, key: string | null = 'test-roblox-key') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) headers['X-Lectio-Key'] = key;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** A non-streaming completion carrying the reflection JSON contract. */
function reflectionMock() {
  return vi.fn(async () => ({
    choices: [
      {
        message: {
          content: '{"cards":[{"text":"A gentle reflection","tags":["peace","rest","trust"]}],"summary":"An overall word."}',
        },
      },
    ],
  }));
}

function fakeStream() {
  return (async function* () {
    yield { choices: [{ delta: { content: 'Hello' } }] };
    yield { choices: [{ delta: { content: ' there' } }] };
  })();
}

let db: D1Memory;
beforeAll(() => {
  db = new D1Memory();
  store.db = db;
});

afterAll(() => {
  db.close();
});

describe('roblox auth', () => {
  it('compares keys in constant time (equal and unequal lengths)', () => {
    expect(keysMatch('abc', 'abc')).toBe(true);
    expect(keysMatch('abc', 'abd')).toBe(false);
    expect(keysMatch('abc', 'ab')).toBe(false);
    expect(keysMatch('', '')).toBe(true);
  });

  it('rejects requests without or with a wrong key (401)', async () => {
    const noKey = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '1', mode: 'daily' }, null) } as never);
    expect(noKey.status).toBe(401);
    const badKey = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '1', mode: 'daily' }, 'wrong') } as never);
    expect(badKey.status).toBe(401);
  });

  it('returns 503 when the integration is not configured', async () => {
    store.apiKey = null;
    try {
      const res = await STATE_POST({ request: request('/api/roblox/state', { playerId: '1' }) } as never);
      expect(res.status).toBe(503);
    } finally {
      store.apiKey = 'test-roblox-key';
    }
  });
});

describe('POST /api/roblox/state', () => {
  it('reports the anonymous starting state for a fresh player', async () => {
    const res = await STATE_POST({ request: request('/api/roblox/state', { playerId: '101', displayName: 'Seeker' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    expect(data.state).toMatchObject({
      registered: false,
      used: 0,
      limit: ANON_DAILY_DRAWS,
      divina: 0,
      deep: 0,
      chatRemaining: ANON_DAILY_MESSAGES,
    });
  });

  it('rejects malformed player ids with 400', async () => {
    const res = await STATE_POST({ request: request('/api/roblox/state', { playerId: 'abc;DROP TABLE users' }) } as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/roblox/register', () => {
  it('registers the player and grants the welcome credits exactly once', async () => {
    await REGISTER_POST({ request: request('/api/roblox/register', { playerId: '202', displayName: 'Pilgrim' }) } as never);
    // Re-registering must never top the credits back up.
    const second = await jsonOf(await REGISTER_POST({ request: request('/api/roblox/register', { playerId: '202', displayName: 'Pilgrim' }) } as never));
    expect(second.ok).toBe(true);
    expect(second.state).toMatchObject({ registered: true, limit: 6, divina: 3, deep: 1 });
    const row = await db.prepare('SELECT registered_at FROM roblox_players WHERE user_key = ?').first<{ registered_at: string }>('rb:202');
    expect(row?.registered_at).toBeTruthy();
  });
});

describe('POST /api/roblox/explore', () => {
  beforeEach(() => {
    store.create = reflectionMock();
  });

  it('draws one verse, records usage and returns the AI reflection', async () => {
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '301', displayName: 'R', topic: 'stillness', mode: 'daily', lang: 'en' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    const verses = data.verses as Array<Record<string, unknown>>;
    expect(verses).toHaveLength(1);
    expect(verses[0].refEn).toBeTruthy();
    expect(verses[0].textEn).toBeTruthy();
    expect(verses[0].interp).toBe('A gentle reflection');
    expect(data.summary).toBe('An overall word.');
    expect(await getTodayUsage('rb:301')).toBe(1);
    const state = data.state as Record<string, unknown>;
    expect(state.used).toBe(1);
  });

  it('falls back to a starter question when the topic is empty', async () => {
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '302', mode: 'daily', topic: '', lang: 'zh' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    expect(typeof data.topic).toBe('string');
    expect(data.topic as string).not.toBe('');
  });

  it('enforces the anonymous daily quota', async () => {
    for (let i = 0; i < ANON_DAILY_DRAWS; i++) await incrementUsage('rb:303');
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '303', mode: 'daily', topic: 'peace' }) } as never);
    const data = await jsonOf(res);
    expect(data).toMatchObject({ ok: false, errorKey: 'limitMsg' });
    // A rejected draw records nothing.
    expect(await getTodayUsage('rb:303')).toBe(ANON_DAILY_DRAWS);
  });

  it('locks multi-verse layouts behind registration for anonymous players', async () => {
    const divina = await jsonOf(await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '304', mode: 'divina' }) } as never));
    expect(divina).toMatchObject({ ok: false, errorKey: 'divinaMsg' });
    const deep = await jsonOf(await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '304', mode: 'deep' }) } as never));
    expect(deep).toMatchObject({ ok: false, errorKey: 'deepMsg' });
  });

  it('spends a welcome credit (not the daily quota) for a registered divina draw', async () => {
    await REGISTER_POST({ request: request('/api/roblox/register', { playerId: '305', displayName: 'R' }) } as never);
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '305', mode: 'divina', topic: 'love', lang: 'en' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    expect(data.verses as unknown[]).toHaveLength(3);
    // Credit draws never touch the daily counter.
    expect(await getTodayUsage('rb:305')).toBe(0);
    expect(await getCreditBalance('rb:305', db as never)).toMatchObject({ '3card': 2, celtic_cross: 1 });
    const state = data.state as Record<string, unknown>;
    expect(state.divina).toBe(2);
  });

  it('reports no_credits once the trial credits are spent', async () => {
    await REGISTER_POST({ request: request('/api/roblox/register', { playerId: '306', displayName: 'R' }) } as never);
    for (let i = 0; i < 3; i++) {
      const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '306', mode: 'divina' }) } as never);
      expect(((await jsonOf(res)) as { ok: boolean }).ok).toBe(true);
    }
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '306', mode: 'divina' }) } as never);
    expect(await jsonOf(res)).toMatchObject({ ok: false, errorKey: 'divinaMsg' });
  });

  it('rejects an unknown mode with 400', async () => {
    const res = await EXPLORE_POST({ request: request('/api/roblox/explore', { playerId: '307', mode: 'tarot' }) } as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/roblox/today', () => {
  it('resolves the lectionary focus passage into per-verse steps', async () => {
    const res = await TODAY_POST({ request: request('/api/roblox/today', { lang: 'en' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    expect(typeof data.titleEn).toBe('string');
    const steps = data.steps as Array<Record<string, string>>;
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.refEn).toBeTruthy();
      expect(step.refZh).toBeTruthy();
      expect(step.en).toBeTruthy();
      expect(step.zh).toBeTruthy();
    }
  });
});

describe('POST /api/roblox/assistant', () => {
  beforeEach(() => {
    store.create = vi.fn(async () => fakeStream());
  });

  it('streams the reply into a full text and charges one message', async () => {
    const res = await ASSISTANT_POST({ request: request('/api/roblox/assistant', { playerId: '401', message: 'What does rest mean?', lang: 'en' }) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    expect(data.text).toBe('Hello there');
    expect(await getChatUsage('rb:401', db as never)).toBe(1);
    expect(data.remaining).toBe(ANON_DAILY_MESSAGES - 1);
  });

  it('stops at the anonymous daily message cap', async () => {
    for (let i = 0; i < ANON_DAILY_MESSAGES; i++) await incrementChatUsage('rb:402', db as never);
    const res = await ASSISTANT_POST({ request: request('/api/roblox/assistant', { playerId: '402', message: 'hi' }) } as never);
    expect(await jsonOf(res)).toMatchObject({ ok: false, errorKey: 'assistantLimitMsg', remaining: 0 });
  });

  it('charges nothing when the model call fails', async () => {
    store.create = vi.fn(async () => {
      throw new Error('boom');
    });
    const res = await ASSISTANT_POST({ request: request('/api/roblox/assistant', { playerId: '403', message: 'hi' }) } as never);
    expect(await jsonOf(res)).toMatchObject({ ok: false, errorKey: 'backendError' });
    expect(await getChatUsage('rb:403', db as never)).toBe(0);
  });

  it('rejects an empty message with 400', async () => {
    const res = await ASSISTANT_POST({ request: request('/api/roblox/assistant', { playerId: '404', message: '   ' }) } as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/roblox/library', () => {
  it('serves the whole deck in book order', async () => {
    const res = await LIBRARY_POST({ request: request('/api/roblox/library', {}) } as never);
    const data = await jsonOf(res);
    expect(data.ok).toBe(true);
    const verses = data.verses as Array<Record<string, unknown>>;
    expect(verses.length).toBeGreaterThan(100);
    for (const v of verses) {
      expect(v.refEn).toBeTruthy();
      expect(v.textZh).toBeTruthy();
      expect(v.bookEn).toBeTruthy();
    }
  });
});
