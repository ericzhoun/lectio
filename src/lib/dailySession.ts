// Persistence for the daily reading: one session row per reader per day, and
// one entry row per step they write at.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import type { Lang } from './reading';
import { STEP_ORDER, stepIndex, type Step } from './dailySteps';

const CREATE_SESSIONS_SQL = `CREATE TABLE IF NOT EXISTS daily_sessions (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  lang TEXT NOT NULL,
  reached_step TEXT NOT NULL DEFAULT 'silencio',
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day)
)`;

const CREATE_ENTRIES_SQL = `CREATE TABLE IF NOT EXISTS daily_step_entries (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  step TEXT NOT NULL,
  user_text TEXT NOT NULL,
  ai_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day, step)
)`;

/** D1's exec() takes single-line statements. */
function flattenSql(sql: string): string {
  return sql.split(/\s+/).join(' ').trim();
}

// Keyed by database rather than a module-level boolean, so a fresh in-memory
// database in a test is always initialised rather than skipped.
const initialized = new WeakSet<object>();

async function ensureTables(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  await db.exec(flattenSql(CREATE_SESSIONS_SQL));
  await db.exec(flattenSql(CREATE_ENTRIES_SQL));
  initialized.add(db);
}

export interface DailySessionRow {
  userId: string;
  day: string;
  lang: Lang;
  reachedStep: Step;
  completedAt: string | null;
}

export interface StepEntry {
  step: Step;
  userText: string;
  aiText: string | null;
}

/** A reader may revisit any step up to the furthest they have reached. */
export function canOpenStep(reached: Step, requested: Step): boolean {
  return stepIndex(requested) <= stepIndex(reached);
}

export async function getSession(
  userId: string, day: string, db: D1Database = env.DB
): Promise<DailySessionRow | null> {
  await ensureTables(db);
  const row = await db
    .prepare(
      'SELECT lang, reached_step, completed_at FROM daily_sessions WHERE user_id = ? AND day = ?'
    )
    .bind(userId, day)
    .first<{ lang: string; reached_step: string; completed_at: string | null }>();
  if (!row) return null;
  return {
    userId,
    day,
    lang: row.lang as Lang,
    reachedStep: row.reached_step as Step,
    completedAt: row.completed_at,
  };
}

export async function ensureSession(
  userId: string, day: string, lang: Lang, db: D1Database = env.DB
): Promise<DailySessionRow> {
  await ensureTables(db);
  // The language is pinned at creation: switching mid-session would strand the
  // reader's own words beside a different translation.
  await db
    .prepare(
      `INSERT INTO daily_sessions (user_id, day, lang) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO NOTHING`
    )
    .bind(userId, day, lang)
    .run();
  const row = await getSession(userId, day, db);
  if (!row) throw new Error(`daily session missing after insert: ${userId} ${day}`);
  return row;
}

export async function saveStepEntry(
  userId: string, day: string, step: Step, userText: string,
  aiText: string | null, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  await db
    .prepare(
      `INSERT INTO daily_step_entries (user_id, day, step, user_text, ai_text)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day, step) DO UPDATE SET
         user_text = excluded.user_text,
         ai_text = excluded.ai_text`
    )
    .bind(userId, day, step, userText, aiText)
    .run();
}

export async function getStepEntries(
  userId: string, day: string, db: D1Database = env.DB
): Promise<StepEntry[]> {
  await ensureTables(db);
  const { results } = await db
    .prepare('SELECT step, user_text, ai_text FROM daily_step_entries WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .all<{ step: string; user_text: string; ai_text: string | null }>();
  return (results ?? [])
    .map((r) => ({ step: r.step as Step, userText: r.user_text, aiText: r.ai_text }))
    .sort((a, b) => stepIndex(a.step) - stepIndex(b.step));
}

export async function advanceTo(
  userId: string, day: string, step: Step, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  const current = await getSession(userId, day, db);
  if (!current) return;
  if (stepIndex(step) <= stepIndex(current.reachedStep)) return;
  await db
    .prepare('UPDATE daily_sessions SET reached_step = ? WHERE user_id = ? AND day = ?')
    .bind(step, userId, day)
    .run();
}

export async function completeSession(
  userId: string, day: string, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  await db
    .prepare(
      `UPDATE daily_sessions SET completed_at = CURRENT_TIMESTAMP, reached_step = ?
       WHERE user_id = ? AND day = ?`
    )
    .bind(STEP_ORDER[STEP_ORDER.length - 1], userId, day)
    .run();
}

export async function listSessions(
  userId: string, limit = 60, db: D1Database = env.DB
): Promise<DailySessionRow[]> {
  await ensureTables(db);
  const { results } = await db
    .prepare(
      `SELECT day, lang, reached_step, completed_at FROM daily_sessions
       WHERE user_id = ? ORDER BY day DESC LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ day: string; lang: string; reached_step: string; completed_at: string | null }>();
  return (results ?? []).map((r) => ({
    userId,
    day: r.day,
    lang: r.lang as Lang,
    reachedStep: r.reached_step as Step,
    completedAt: r.completed_at,
  }));
}
