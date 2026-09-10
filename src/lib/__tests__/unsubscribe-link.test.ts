// The minting half and the redeeming half of an unsubscribe link have to agree
// on the token AND on the query parameter names (?e= and ?t=). They live in
// different functions, so this test locks them together: whatever URL
// sendUnsubscribeLink puts in the mail is fed straight back through
// unsubscribeFromRequest.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { D1Memory } from './helpers/d1-memory';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('cloudflare:workers', () => ({
  env: {
    get DB() {
      return holder.db;
    },
    MAIL_TOKEN_SECRET: 'test-mail-secret',
    RESEND_API_KEY: 'test-resend-key',
  },
}));

import {
  addSubscriber, ensureSubscriberTable, getSubscriber, resetSubscriberTableCache,
} from '../subscribers';
import { sendUnsubscribeLink, unsubscribeFromRequest } from '../unsubscribe';

const fetchMock = vi.fn(
  async (_url: string, _init?: { body?: unknown }) => new Response('{}', { status: 200 })
);

async function freshDb(): Promise<D1Database> {
  const db = new D1Memory() as unknown as D1Database;
  resetSubscriberTableCache();
  await ensureSubscriberTable(db);
  holder.db = db;
  return db;
}

/** The unsubscribe URL out of the message Resend was handed. */
function sentLink(): string {
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Array<{
    headers: { 'List-Unsubscribe': string };
  }>;
  return body[0].headers['List-Unsubscribe'].replace(/^<|>$/g, '');
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('sendUnsubscribeLink', () => {
  it('mints a link the unsubscribe route actually redeems', async () => {
    const db = await freshDb();
    await addSubscriber(db, { email: 'Reader@Example.test', lang: 'en', tz: 'UTC' });

    await sendUnsubscribeLink('  Reader@Example.test ', db, 'https://enjoyhim.org');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const link = sentLink();
    expect(link).toContain('/unsubscribe?e=');
    expect(await unsubscribeFromRequest(new URL(link))).toBe(true);
    expect((await getSubscriber(db, 'reader@example.test'))?.status).toBe('unsubscribed');
  });

  it('carries the reader\'s language through to the page', async () => {
    const db = await freshDb();
    await addSubscriber(db, { email: 'reader@example.test', lang: 'zh', tz: 'UTC' });
    await sendUnsubscribeLink('reader@example.test', db, 'https://enjoyhim.org/');
    const link = sentLink();
    expect(link).toContain('lang=zh');
    // A trailing slash on the origin must not produce a double slash.
    expect(link).toContain('https://enjoyhim.org/unsubscribe?');
  });

  it('says nothing at all about an address that is not on the list', async () => {
    const db = await freshDb();
    await sendUnsubscribeLink('stranger@example.test', db, 'https://enjoyhim.org');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not re-mail someone who already unsubscribed', async () => {
    const db = await freshDb();
    await addSubscriber(db, { email: 'gone@example.test', lang: 'en', tz: 'UTC' });
    const token = new URL(await mintedLinkFor(db, 'gone@example.test'));
    expect(await unsubscribeFromRequest(token)).toBe(true);
    fetchMock.mockClear();
    await sendUnsubscribeLink('gone@example.test', db, 'https://enjoyhim.org');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function mintedLinkFor(db: D1Database, email: string): Promise<string> {
  fetchMock.mockClear();
  await sendUnsubscribeLink(email, db, 'https://enjoyhim.org');
  return sentLink();
}
