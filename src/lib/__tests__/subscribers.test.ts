import { beforeEach, describe, expect, it } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  activeSubscribers,
  addSubscriber,
  ensureSubscriberTable,
  markSent,
  resetSubscriberTableCache,
  setStatus,
} from '../subscribers';

let db: any;

beforeEach(async () => {
  resetSubscriberTableCache();
  db = new D1Memory();
  await ensureSubscriberTable(db);
});

describe('subscriber storage', () => {
  it('stores an address with its language and timezone', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'Asia/Shanghai' });
    const rows = await activeSubscribers(db);
    expect(rows).toEqual([
      { email: 'reader@example.test', lang: 'en', tz: 'Asia/Shanghai', lastSent: null },
    ]);
  });

  it('defaults an unusable timezone to Pacific rather than rejecting the signup', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'Mars/Olympus' });
    expect((await activeSubscribers(db))[0].tz).toBe('America/Los_Angeles');
  });

  it('treats a repeat signup as an update, not an error', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'reader@example.test', lang: 'zh', tz: 'Asia/Shanghai' });
    const rows = await activeSubscribers(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].lang).toBe('zh');
    expect(rows[0].tz).toBe('Asia/Shanghai');
  });

  it('brings an unsubscribed reader back when they sign up again', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await markSent(db, ['reader@example.test'], '2026-09-08');
    await setStatus(db, 'reader@example.test', 'unsubscribed');
    expect(await activeSubscribers(db)).toHaveLength(0);
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    const rows = await activeSubscribers(db);
    expect(rows).toHaveLength(1);
    // The upsert must not clobber last_sent, or a resubscribe on the same
    // local day would look unsent and trigger a duplicate delivery.
    expect(rows[0].lastSent).toBe('2026-09-08');
  });

  it('hides unsubscribed and bounced readers from the send list', async () => {
    await addSubscriber(db, { email: 'gone@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'bounced@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'here@example.test', lang: 'en', tz: 'UTC' });
    await setStatus(db, 'gone@example.test', 'unsubscribed');
    await setStatus(db, 'bounced@example.test', 'bounced');
    expect((await activeSubscribers(db)).map((r) => r.email)).toEqual(['here@example.test']);
  });

  it('records the local day a send went out', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await markSent(db, ['reader@example.test'], '2026-09-09');
    expect((await activeSubscribers(db))[0].lastSent).toBe('2026-09-09');
  });

  it('marks nothing and does not throw when the delivered list is empty', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await markSent(db, [], '2026-09-09');
    expect((await activeSubscribers(db))[0].lastSent).toBeNull();
  });

  it('normalises the address so the same reader cannot enrol twice', async () => {
    await addSubscriber(db, { email: 'Reader@Example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    expect(await activeSubscribers(db)).toHaveLength(1);
  });
});
