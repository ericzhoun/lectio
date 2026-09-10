// Everything that knows the shape of daily_invitations. Routes and the cron
// handler talk to this module, never to SQL, so the schema has one owner.
import type { D1Database } from '@cloudflare/workers-types';
import { isValidTimeZone } from './localDay';
import { DEFAULT_TIMEZONE, type Subscriber } from './mailSchedule';
import type { Lang } from './reading';

export const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS daily_invitations (' +
  'email TEXT PRIMARY KEY, ' +
  'lang TEXT, ' +
  'created_at DATETIME DEFAULT CURRENT_TIMESTAMP, ' +
  "tz TEXT NOT NULL DEFAULT 'America/Los_Angeles', " +
  "status TEXT NOT NULL DEFAULT 'active', " +
  'last_sent TEXT)';

let initialized = false;

/** Columns the code assumes exist beyond the original three-column table. */
const REQUIRED_COLUMNS = ['tz', 'status', 'last_sent'];

export async function ensureSubscriberTable(db: D1Database): Promise<void> {
  if (initialized) return;
  // CREATE TABLE IF NOT EXISTS is a no-op against production's existing
  // three-column table, so a deploy that outruns the migration script would
  // otherwise fail invisibly: every signup INSERT references tz/status, and
  // the cron's SELECT throws "no such column" into a log nobody reads. This
  // check makes that failure loud instead of silent.
  await db.exec(CREATE_TABLE_SQL);
  const { results } = await db.prepare('PRAGMA table_info(daily_invitations)').bind().all<{
    name: string;
  }>();
  const columns = new Set((results ?? []).map((row) => row.name));
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.has(name));
  if (missing.length > 0) {
    console.error(
      'daily-invitation: daily_invitations table is missing column(s)',
      missing.join(', '),
      '- run scripts/migrate-daily-invitations.mjs'
    );
  }
  initialized = true;
}

/** Test seam: the module-level guard would otherwise leak between test files. */
export function resetSubscriberTableCache(): void {
  initialized = false;
}

export interface NewSubscriber {
  email: string;
  lang: Lang;
  tz: string;
}

export async function addSubscriber(db: D1Database, input: NewSubscriber): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const tz = isValidTimeZone(input.tz) ? input.tz : DEFAULT_TIMEZONE;
  // A returning reader is not an error, and someone re-subscribing after
  // unsubscribing means exactly that: put them back on the list.
  await db
    .prepare(
      'INSERT INTO daily_invitations (email, lang, tz, status) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(email) DO UPDATE SET lang = ?2, tz = ?3, status = ?4'
    )
    .bind(email, input.lang, tz, 'active')
    .run();
}

export async function activeSubscribers(db: D1Database): Promise<Subscriber[]> {
  const { results } = await db
    .prepare(
      "SELECT email, lang, tz, last_sent FROM daily_invitations WHERE status = 'active'"
    )
    .bind()
    .all<{ email: string; lang: string; tz: string; last_sent: string | null }>();

  return (results ?? []).map((row) => ({
    email: row.email,
    lang: row.lang === 'zh' ? 'zh' : 'en',
    tz: row.tz ?? DEFAULT_TIMEZONE,
    lastSent: row.last_sent ?? null,
  }));
}

/** One reader's row, including inactive ones: the assistant must be able to
 *  say "you unsubscribed in March", not just "you are not on the list". */
export interface SubscriberRecord {
  email: string;
  lang: Lang;
  tz: string;
  status: string;
  lastSent: string | null;
}

export async function getSubscriber(
  db: D1Database,
  email: string
): Promise<SubscriberRecord | null> {
  const row = await db
    .prepare('SELECT email, lang, tz, status, last_sent FROM daily_invitations WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<{ email: string; lang: string; tz: string; status: string; last_sent: string | null }>();
  if (!row) return null;
  return {
    email: row.email,
    lang: row.lang === 'zh' ? 'zh' : 'en',
    tz: row.tz ?? DEFAULT_TIMEZONE,
    status: row.status,
    lastSent: row.last_sent ?? null,
  };
}

export async function markSent(
  db: D1Database,
  emails: string[],
  localDay: string
): Promise<void> {
  if (emails.length === 0) return;
  const statements = emails.map((email) =>
    db
      .prepare('UPDATE daily_invitations SET last_sent = ?1 WHERE email = ?2')
      .bind(localDay, email)
  );
  await db.batch(statements);
}

export async function setStatus(
  db: D1Database,
  email: string,
  status: 'unsubscribed' | 'bounced'
): Promise<void> {
  await db
    .prepare('UPDATE daily_invitations SET status = ?1 WHERE email = ?2')
    .bind(status, email.trim().toLowerCase())
    .run();
}
