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

const CREATE_RENDERINGS_SQL = `CREATE TABLE IF NOT EXISTS reading_renderings (
  reading_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reading_id, lang)
)`;

/** D1's exec() takes single-line statements. */
function flattenSql(sql: string): string {
  return sql.split(/\s+/).join(' ').trim();
}

let initialized = false;
let renderingsInitialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  initialized = true;
}

async function ensureRenderingsTable(db: D1Database): Promise<void> {
  if (renderingsInitialized) return;
  await db.exec(flattenSql(CREATE_RENDERINGS_SQL));
  renderingsInitialized = true;
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

// ---- Per-language reflection cache ---------------------------------------
// A reading's reflection is written in one language. Switching the site
// language re-renders the same verses and needs the reflection in the other
// language, so each (reading, language) pair is generated once and cached
// here. Purely a cache: a miss costs a regeneration, never correctness.

/** Reflection for one reading in one language. */
export interface ReadingRendering {
  summary: string;
  cards: { text: string; tags: string[] }[];
  followUps: string[];
}

export async function getReadingRendering(
  readingId: string,
  lang: string
): Promise<ReadingRendering | null> {
  const db = env.DB;
  if (!db) return null;
  try {
    await ensureRenderingsTable(db);
    const row = await db
      .prepare('SELECT payload FROM reading_renderings WHERE reading_id = ? AND lang = ?')
      .bind(readingId, lang)
      .first<{ payload: string }>();
    return row ? (JSON.parse(row.payload) as ReadingRendering) : null;
  } catch (e) {
    console.error('Error reading reading_renderings:', e);
    return null;
  }
}

export async function saveReadingRendering(
  readingId: string,
  lang: string,
  rendering: ReadingRendering
): Promise<void> {
  const db = env.DB;
  if (!db) return;
  try {
    await ensureRenderingsTable(db);
    await db
      .prepare(
        'INSERT OR REPLACE INTO reading_renderings (reading_id, lang, payload) VALUES (?, ?, ?)'
      )
      .bind(readingId, lang, JSON.stringify(rendering))
      .run();
  } catch (e) {
    console.error('Error writing reading_renderings:', e);
  }
}
