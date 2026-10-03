// Pinned-verse draws: the path a reader takes when they bring their own
// question to a verse library page. Kept in its own file because the reading
// flow's own draw tests are mocked separately, and this behaviour has a
// distinct failure mode worth its own describe block.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  entitlement: { ok: true } as { ok: boolean; gated?: boolean; reason?: string },
  recorded: [] as unknown[][],
  logged: [] as unknown[][],
}));

vi.mock('cloudflare:workers', () => ({ env: { DB: null } }));
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
import { getLibraryVerseByRef } from '../scripture';

beforeEach(() => {
  store.entitlement = { ok: true };
  store.recorded = [];
  store.logged = [];
});

describe('performDraw with a pinned verse', () => {
  it('draws the requested verse instead of a random one', async () => {
    const out = await performDraw({
      question: 'How do I face this season of pressure at work?',
      spreadKey: 'single', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
      pinnedRef: 'Philippians 4:13',
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    expect(out.verses).toHaveLength(1);
    expect(out.verses[0]!.refEn).toBe('Philippians 4:13');
    expect(out.verses[0]!.position).toBeTruthy();
    // Still a real reading: reflected on, logged, recorded. Only the draw is
    // deterministic, so entitlement and accounting must not be skipped.
    expect(out.verses[0]!.interp_text).toBe('card text');
    expect(store.logged).toHaveLength(1);
    expect(store.recorded).toEqual([['u1', 'single', true]]);
  });

  it("serves the pinned verse's own text in the reader's language", async () => {
    const out = await performDraw({
      question: '压力', spreadKey: 'single', lang: 'zh',
      userId: 'u1', registered: true, ipAddress: null,
      pinnedRef: 'Philippians 4:13',
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    const deck = getLibraryVerseByRef('Philippians 4:13');
    if (!deck) throw new Error('expected Philippians 4:13 in the deck');
    expect(out.verses[0]!.refZh).toBe(deck.refZh);
    expect(out.verses[0]!.textZh).toBe(deck.textZh);
    expect(/[\u4e00-\u9fa5]/.test(out.verses[0]!.textZh)).toBe(true);
  });

  it('ignores a pin outside the deck and still returns a reading', async () => {
    const out = await performDraw({
      question: 'q', spreadKey: 'single', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
      pinnedRef: 'Hezekiah 9:9',
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    expect(out.verses).toHaveLength(1);
    expect(out.verses[0]!.refEn).not.toBe('Hezekiah 9:9');
  });

  it('ignores a pin on a multi-verse layout', async () => {
    const out = await performDraw({
      question: 'q', spreadKey: '3card', lang: 'en',
      userId: 'pro', registered: true, ipAddress: null,
      pinnedRef: 'Philippians 4:13',
    });
    expect(out.kind).toBe('reading');
    if (out.kind !== 'reading') return;
    expect(out.verses).toHaveLength(3);
  });

  it('still honours entitlement when a verse is pinned', async () => {
    store.entitlement = { ok: false, reason: 'quota' };
    const out = await performDraw({
      question: 'q', spreadKey: 'single', lang: 'en',
      userId: 'u1', registered: true, ipAddress: null,
      pinnedRef: 'Philippians 4:13',
    });
    expect(out).toEqual({ kind: 'blocked', reason: 'quota' });
    expect(store.logged).toEqual([]);
    expect(store.recorded).toEqual([]);
  });

  it('pins every deck verse to itself, not to a lookalike', async () => {
    // A pin must survive references that share a book or chapter prefix, which
    // is where a naive string match would go wrong.
    for (const ref of ['Psalm 23:1', 'Psalm 23:4', '1 John 4:18', '1 John 4:19', 'John 3:16']) {
      const out = await performDraw({
        question: 'q', spreadKey: 'single', lang: 'en',
        userId: 'u1', registered: true, ipAddress: null,
        pinnedRef: ref,
      });
      expect(out.kind).toBe('reading');
      if (out.kind !== 'reading') return;
      expect(out.verses[0]!.refEn, ref).toBe(ref);
    }
  });
});
