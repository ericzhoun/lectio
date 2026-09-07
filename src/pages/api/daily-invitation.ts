// The Daily Invitation: a quiet morning-verse email list.
// Stores only the address; a future delivery job reads the table.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS daily_invitations (email TEXT PRIMARY KEY, lang TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)';

let initialized = false;
async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL);
  initialized = true;
}

// Deliberately plain: an address, not a profile.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let lang = 'en';
  try {
    const body = (await request.json()) as { email?: unknown; lang?: unknown };
    email = String(body.email ?? '').trim().toLowerCase();
    lang = body.lang === 'zh' ? 'zh' : 'en';
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), { status: 400 });
  }

  try {
    const db = env.DB as D1Database;
    await ensureTable(db);
    // A duplicate is not an error: the reader is already on the list.
    await db
      .prepare('INSERT INTO daily_invitations (email, lang) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING')
      .bind(email, lang)
      .run();
  } catch (e) {
    console.error('daily-invitation: store failed:', e);
    return new Response(JSON.stringify({ ok: false, error: 'storage' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
