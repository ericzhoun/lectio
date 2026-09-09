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

export async function ensureSubscriberTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL);
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
