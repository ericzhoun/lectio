import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  draw_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(userId: string): Promise<number> {
  const db = env.DB;
  await ensureTable(db);
  const row = await db
    .prepare('SELECT draw_count FROM usage_daily WHERE user_id = ? AND date = ?')
    .bind(userId, todayUtc())
    .first<{ draw_count: number }>();
  return row?.draw_count ?? 0;
}

export async function incrementUsage(userId: string): Promise<void> {
  const db = env.DB;
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO usage_daily (user_id, date, draw_count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET draw_count = draw_count + 1`
    )
    .bind(userId, todayUtc())
    .run();
}
