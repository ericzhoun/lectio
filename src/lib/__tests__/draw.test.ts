import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  entitlement: { ok: true } as { ok: boolean; gated?: boolean; reason?: string },
  recorded: [] as unknown[][],
  logged: [] as unknown[][],
}));

vi.mock('cloudflare:workers', () => ({ env: { DB: null, SESSION_SECRET: '***' } }));
vi.mock('../entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entitlements')>()),
  canDraw: vi.fn(async () => store.entitlement),
  recordDraw: vi.fn(async (...args: unknown[]) => { store.recorded.push(args); }),
}));
vi.mock('../openai', () => ({
  generateInterpretation: vi.fn(async () => ({
    summary: 'a summary',
    cards: [{ text: 'card text', tags: ['hope'] }],
  })),
  generateFollowUpQuestions: vi.fn(async () => ['and then?']),
}));
vi.mock('../db', () => ({ logReading: vi.fn(async (...args: unknown[]) => { store.logged.push(args); }) }));

import { performDraw } from '../draw';

beforeEach(() => {
  store.entitlement = { ok: true };
  store.recorded = [];
  store.logged = [];
});

describe('performDraw', () => {
  it('draws, reflects, logs and records a permitted single reading', async () => {
    const out = await performDraw({
      question: 'What should I attend to?', spreadKey: 'single', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    expect(out.verses).toHaveLength(1);
    expect(out.verses[0].position).toBeTruthy();
    expect(out.verses[0].interp_text).toBe('card text');
    expect(out.summary).toBe('a summary');
    expect(out.followUps).toEqual(['and then?']);
    expect(out.readingId).toMatch(/[0-9a-f-]{36}/);
    expect(store.logged).toHaveLength(1);
    expect(store.recorded).toEqual([['u1', 'single', true]]);
  });

  it('returns blocked with the reason and spends nothing when out of quota', async () => {
    store.entitlement = { ok: false, reason: 'quota' };
    const out = await performDraw({
      question: 'q', spreadKey: 'single', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
    });
    expect(out).toEqual({ kind: 'blocked', reason: 'quota' });
    expect(store.logged).toEqual([]);
    expect(store.recorded).toEqual([]);
  });

  it('returns gated for the anonymous multi-verse flow without logging', async () => {
    store.entitlement = { ok: true, gated: true };
    const out = await performDraw({
      question: 'q', spreadKey: '3card', lang: 'en',
      userId: 'anon', registered: false, ipAddress: null,
    });
    expect(out).toEqual({ kind: 'gated' });
    expect(store.logged).toEqual([]);
  });

  it('falls back to the single layout for an unknown layout key', async () => {
    const out = await performDraw({
      question: 'q', spreadKey: 'nonsense', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    expect(out.spreadKey).toBe('single');
  });
});
