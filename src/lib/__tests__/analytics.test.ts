import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { ingestClientEvents } from '../analytics';
import { D1Memory } from './helpers/d1-memory';

// D1Memory implements the parts of D1Database these code paths use.
const asD1 = (db: D1Memory) => db as unknown as D1Database;

interface Row {
  name: string;
  visitor_id: string;
  path: string | null;
  lang: string | null;
  variants: string;
  props: string | null;
}

function makeDb() {
  return new D1Memory();
}

async function insertedRows(db: D1Memory): Promise<Row[]> {
  return db
    .prepare('SELECT name, visitor_id, path, lang, variants, props FROM analytics_events')
    .all() as unknown as Promise<Row[]>;
}

describe('ingestClientEvents', () => {
  it('stores a valid batch', async () => {
    const db = makeDb();
    const count = await ingestClientEvents(asD1(db), 'visitor-1', {
      events: [
        { name: 'page_view', path: '/today', lang: 'zh' },
        {
          name: 'audio_play',
          path: '/today/lectio',
          lang: 'en',
          variants: { signup_cta_copy: 'invitation' },
          props: { player: 'clip', clip: 'lectio' },
        },
      ],
    });
    expect(count).toBe(2);
    const rows = await insertedRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('page_view');
    expect(JSON.parse(rows[1].variants)).toEqual({ signup_cta_copy: 'invitation' });
    expect(JSON.parse(rows[1].props ?? 'null')).toEqual({ player: 'clip', clip: 'lectio' });
  });

  it('rejects unknown event names', async () => {
    const db = makeDb();
    const count = await ingestClientEvents(asD1(db), 'visitor-1', {
      events: [{ name: 'not_a_real_event' }],
    });
    expect(count).toBe(0);
  });

  it('caps the batch size', async () => {
    const db = makeDb();
    const events = Array.from({ length: 100 }, () => ({ name: 'page_view' }));
    const count = await ingestClientEvents(asD1(db), 'visitor-1', { events });
    expect(count).toBe(25);
  });

  it('drops malformed props instead of failing', async () => {
    const db = makeDb();
    const count = await ingestClientEvents(asD1(db), 'visitor-1', {
      events: [
        { name: 'page_view', props: { ok: 'fine', nope: { nested: true }, num: 3, big: 'x'.repeat(500) } },
      ],
    });
    expect(count).toBe(1);
    const rows = await insertedRows(db);
    expect(JSON.parse(rows[0].props ?? 'null')).toEqual({ ok: 'fine', num: 3 });
  });

  it('returns 0 for garbage payloads', async () => {
    const db = makeDb();
    expect(await ingestClientEvents(asD1(db), 'visitor-1', null)).toBe(0);
    expect(await ingestClientEvents(asD1(db), 'visitor-1', 'hello')).toBe(0);
    expect(await ingestClientEvents(asD1(db), 'visitor-1', { events: 'nope' })).toBe(0);
    expect(await ingestClientEvents(asD1(db), 'visitor-1', { events: [null, 42, 'x'] })).toBe(0);
  });
});
