// src/lib/chatUsage.ts
// Daily chat-message counters, keyed by visitor (registered user or anonymous
// cookie) and UTC date. Mirrors the usage_daily pattern from usage.ts but takes
// the D1 handle explicitly so vitest can run it against D1Memory.
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS chat_usage_daily (
  visitor_key TEXT NOT NULL,
  date TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_key, date)
)`;

const initializedByDb = new WeakSet<object>();

async function ensureTable(db: D1Database): Promise<void> {
  if (initializedByDb.has(db as unknown as object)) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initializedByDb.add(db as unknown as object);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getChatUsage(visitorKey: string, db: D1Database): Promise<number> {
  await ensureTable(db);
  const row = await db
    .prepare('SELECT message_count FROM chat_usage_daily WHERE visitor_key = ? AND date = ?')
    .bind(visitorKey, todayUtc())
    .first<{ message_count: number }>();
  return row?.message_count ?? 0;
}

export async function incrementChatUsage(visitorKey: string, db: D1Database): Promise<void> {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO chat_usage_daily (visitor_key, date, message_count) VALUES (?, ?, 1)
       ON CONFLICT(visitor_key, date) DO UPDATE SET message_count = message_count + 1`
    )
    .bind(visitorKey, todayUtc())
    .run();
}
