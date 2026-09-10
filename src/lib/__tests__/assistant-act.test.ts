import { describe, it, expect, vi, beforeEach } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const store = vi.hoisted(() => ({ db: null as unknown, userId: 'u1' as string | null }));

vi.mock('cloudflare:workers', () => ({
  env: {
    get DB() { return store.db; },
    SESSION_SECRET: 'sekrit',
  },
}));
vi.mock('../../lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/session')>()),
  verifySessionToken: vi.fn(async () => store.userId),
}));
vi.mock('../../lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/entitlements')>()),
  resolveTier: vi.fn(async () => 'free' as const),
}));
// The reading itself is drawn by performDraw, which is exercised by its own
// tests. Here the only question is what the endpoint does with the outcome.
vi.mock('../../lib/draw', () => ({
  performDraw: vi.fn(async () => ({
    kind: 'reading',
    readingId: 'rid-1',
    spreadKey: 'single',
    verses: [
      {
        refEn: 'John 15:5', refZh: '约翰福音 15:5',
        position: 'The Word for Today', textEn: 'I am the vine',
        interp_text: 'abide', tags: ['abiding'],
      },
    ],
    summary: 'stay close',
    followUps: ['what holds you?'],
  })),
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  saveReadingRendering: vi.fn(async () => undefined),
}));

import { POST } from '../../pages/api/assistant/act';
import { performDraw } from '../draw';
import { signCardToken, CARD_TTL_MS } from '../assistantCards';
import { ensureSubscriberTable, getSubscriber, resetSubscriberTableCache } from '../subscribers';
import { LAST_READING_COOKIE, verifyLastReadingToken } from '../lastReading';
import { saveReadingRendering } from '../db';

type SetCookie = { name: string; value: string; options: Record<string, unknown> };

function request(
  body: unknown,
  origin = 'https://enjoyhim.org',
  sink?: SetCookie[],
  cookieMap?: Record<string, string>
) {
  const jar: Record<string, string> = cookieMap ?? { session: 'session-token' };
  return {
    request: new Request('https://enjoyhim.org/api/assistant/act', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
    cookies: {
      get: (name: string) => (jar[name] !== undefined ? { value: jar[name] } : undefined),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        sink?.push({ name, value, options });
      },
      delete: () => {},
    },
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(async () => {
  store.userId = 'u1';
  store.db = new D1Memory();
  resetSubscriberTableCache();
  await ensureSubscriberTable(store.db as never);
});

describe('POST /api/assistant/act', () => {
  it('runs the tool named by a valid card', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:u1' },
      'sekrit'
    );
    const res = await POST(request({ token }));
    expect(res.status).toBe(200);
    expect((await getSubscriber(store.db as never, 'reader@example.com'))?.status).toBe('active');
  });

  it('ignores args resent by the client and uses the signed ones', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:u1' },
      'sekrit'
    );
    await POST(request({ token, args: { email: 'attacker@example.com', lang: 'en', tz: 'UTC' } }));
    expect(await getSubscriber(store.db as never, 'attacker@example.com')).toBeNull();
    expect(await getSubscriber(store.db as never, 'reader@example.com')).not.toBeNull();
  });

  it('rejects a card issued to another visitor', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:someone-else' },
      'sekrit'
    );
    const res = await POST(request({ token }));
    expect(res.status).toBe(400);
    expect(await getSubscriber(store.db as never, 'reader@example.com')).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:u1' },
      'not-the-secret'
    );
    expect((await POST(request({ token }))).status).toBe(400);
  });

  it('rejects an expired card', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:u1' },
      'sekrit'
    );
    vi.setSystemTime(new Date(Date.now() + CARD_TTL_MS + 1000));
    expect((await POST(request({ token }))).status).toBe(400);
    vi.useRealTimers();
  });

  it('rejects a cross-origin confirm', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'reader@example.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:u1' },
      'sekrit'
    );
    expect((await POST(request({ token }, 'https://evil.example'))).status).toBe(403);
  });

  it('refuses a user-only tool when the session is gone', async () => {
    store.userId = null;
    const token = await signCardToken({ tool: 'open_billing', args: {}, visitorKey: 'u:u1' }, 'sekrit');
    expect((await POST(request({ token }))).status).toBe(401);
  });

  it('refuses a read tool: only a write tool is ever confirmed', async () => {
    const token = await signCardToken({ tool: 'get_me', args: {}, visitorKey: 'u:u1' }, 'sekrit');
    expect((await POST(request({ token }))).status).toBe(400);
  });

  it('mints a user_id for a guest and bills the draw to it, not the visitor key', async () => {
    store.userId = null;
    vi.mocked(performDraw).mockClear();
    const token = await signCardToken(
      { tool: 'start_reading', args: { question: 'What now?', layout: 'single' }, visitorKey: 'a:guest-1' },
      'sekrit'
    );
    const sink: SetCookie[] = [];
    const res = await POST(
      request({ token }, 'https://enjoyhim.org', sink, { chat_anon: 'a:guest-1' })
    );
    expect(res.status).toBe(200);

    const minted = sink.find((c) => c.name === 'user_id');
    expect(minted).toBeDefined();
    // Exactly what src/pages/index.astro sets, so the page and the assistant
    // share one visitor id rather than each granting a free allowance.
    expect(minted!.options).toEqual({ path: '/', httpOnly: true });
    expect(minted!.value).toMatch(/^[0-9a-f-]{36}$/);
    // The draw is billed to that id, never to the chat visitor key.
    expect(vi.mocked(performDraw).mock.calls[0][0].userId).toBe(minted!.value);
  });

  it('does not share one quota bucket between visitors with an empty user_id', async () => {
    store.userId = null;
    vi.mocked(performDraw).mockClear();
    const token = await signCardToken(
      { tool: 'start_reading', args: { question: 'What now?', layout: 'single' }, visitorKey: 'a:guest-2' },
      'sekrit'
    );
    const sink: SetCookie[] = [];
    await POST(
      request({ token }, 'https://enjoyhim.org', sink, { chat_anon: 'a:guest-2', user_id: '  ' })
    );
    const minted = sink.find((c) => c.name === 'user_id');
    expect(minted).toBeDefined();
    expect(vi.mocked(performDraw).mock.calls[0][0].userId).toBe(minted!.value);
    expect(vi.mocked(performDraw).mock.calls[0][0].userId).not.toBe('');
  });

  it('keeps an existing user_id as the billing subject', async () => {
    store.userId = null;
    vi.mocked(performDraw).mockClear();
    const token = await signCardToken(
      { tool: 'start_reading', args: { question: 'What now?', layout: 'single' }, visitorKey: 'a:guest-3' },
      'sekrit'
    );
    const sink: SetCookie[] = [];
    await POST(
      request({ token }, 'https://enjoyhim.org', sink, { chat_anon: 'a:guest-3', user_id: 'site-user-9' })
    );
    expect(sink.find((c) => c.name === 'user_id')).toBeUndefined();
    expect(vi.mocked(performDraw).mock.calls[0][0].userId).toBe('site-user-9');
  });

  it('remembers a confirmed reading in the last_reading cookie', async () => {
    const token = await signCardToken(
      { tool: 'start_reading', args: { question: 'What now?', layout: 'single' }, visitorKey: 'u:u1' },
      'sekrit'
    );
    const sink: SetCookie[] = [];
    const res = await POST(request({ token }, 'https://enjoyhim.org', sink));
    expect(res.status).toBe(200);

    const cookie = sink.find((c) => c.name === LAST_READING_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie!.options).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax', secure: true });
    // The English refs are what rebuildDrawnVerses needs to put the reading
    // back on screen when the visitor opens the full reading.
    const last = await verifyLastReadingToken(cookie!.value, 'sekrit');
    expect(last).toMatchObject({ id: 'rid-1', spread: 'single', question: 'What now?', verses: ['John 15:5'] });
    expect(vi.mocked(saveReadingRendering)).toHaveBeenCalledWith('rid-1', 'en', {
      summary: 'stay close',
      cards: [{ text: 'abide', tags: ['abiding'] }],
      followUps: ['what holds you?'],
    });
  });
});
