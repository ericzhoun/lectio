import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS drawing_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  verses TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  ip_address TEXT,
  user_id TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

/** Minimal shape a drawn verse satisfies when logging. */
export interface LoggedItem {
  en: string;
  zh?: string;
}

export async function logReading(
  question: string,
  items: LoggedItem[],
  interpretation: string,
  ipAddress: string | null,
  userId: string | null
): Promise<void> {
  const db = env.DB;
  if (!db) {
    console.error('Error logging reading: no D1 binding (env.DB) available');
    return;
  }
  try {
    await ensureTable(db);
    const versesStr = items.map((c) => (c.zh ? `${c.en} / ${c.zh}` : c.en)).join(',');
    await db
      .prepare(
        'INSERT INTO drawing_sessions (question, verses, interpretation, ip_address, user_id) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(question, versesStr, interpretation, ipAddress, userId)
      .run();
  } catch (e) {
    console.error('Error logging reading:', e);
  }
}

export async function getReadingsForUser(
  userId: string,
  limit = 50
): Promise<Array<{ id: number; question: string; verses: string; interpretation: string; timestamp: string }>> {
  const db = env.DB;
  await ensureTable(db);
  const result = await db
    .prepare(
      'SELECT id, question, verses, interpretation, timestamp FROM drawing_sessions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
    )
    .bind(userId, limit)
    .all<{ id: number; question: string; verses: string; interpretation: string; timestamp: string }>();
  return result.results ?? [];
}
