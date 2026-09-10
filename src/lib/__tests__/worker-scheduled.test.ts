import { beforeEach, describe, expect, it, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import { sendDailyInvitations } from '../sendDaily';
import {
  addSubscriber,
  ensureSubscriberTable,
  resetSubscriberTableCache,
  activeSubscribers,
} from '../subscribers';

const SECRET = 'test-mail-secret';
const API_KEY = 'key-123';
// 13:00Z is 06:00 in Los Angeles on this date.
const SIX_AM_PACIFIC = new Date('2026-09-09T13:00:00Z');

let db: any;

function okFetch() {
  // A fresh Response per call: mockResolvedValue would hand back the SAME
  // instance every time, and a Response body can only be read once - a
  // second call in the same test would throw on a consumed body.
  return vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
}

beforeEach(async () => {
  resetSubscriberTableCache();
  db = new D1Memory();
  await ensureSubscriberTable(db);
});

describe('sendDailyInvitations', () => {
  it('sends one batch to the readers whose morning it is and records the day', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    await addSubscriber(db, { email: 'sh@example.test', lang: 'zh', tz: 'Asia/Shanghai' });
    const fetchImpl = okFetch();

    const result = await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toHaveLength(1);
    expect(body[0].to).toEqual(['la@example.test']);
    expect(result.sent).toBe(1);

    const rows = await activeSubscribers(db);
    expect(rows.find((r) => r.email === 'la@example.test')!.lastSent).toBe('2026-09-09');
    expect(rows.find((r) => r.email === 'sh@example.test')!.lastSent).toBeNull();
  });

  it('does nothing at all when no one is due', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const result = await sendDailyInvitations({
      db,
      now: new Date('2026-09-09T20:00:00Z'),
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('leaves last_sent untouched when Resend rejects the batch, so the next tick retries', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));

    const result = await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sent).toBe(0);
    expect((await activeSubscribers(db))[0].lastSent).toBeNull();
  });

  it('does not send the same reader twice in one local day', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const deps = {
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    await sendDailyInvitations(deps);
    await sendDailyInvitations(deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives every reader an unsubscribe link that verifies', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const header = body[0].headers['List-Unsubscribe'];
    const url = new URL(header.slice(1, -1));
    const { verifyMailToken } = await import('../mailToken');
    expect(await verifyMailToken(url.searchParams.get('e')!, url.searchParams.get('t')!, SECRET)).toBe(
      true
    );
  });

  it('skips a reader whose passage will not resolve rather than mailing a broken email', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const result = await sendDailyInvitations({
      db,
      // A date far outside the generated lectionary window.
      now: new Date('1990-01-01T14:00:00Z'),
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});
