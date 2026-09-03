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
