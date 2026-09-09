// The Daily Invitation: a quiet morning-verse email list.
// Stores an address, a language, and a timezone; src/worker.ts reads the table
// on its hourly tick and sends at 06:00 in the reader's own morning.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { addSubscriber, ensureSubscriberTable } from '../../lib/subscribers';
import { DEFAULT_TIMEZONE } from '../../lib/mailSchedule';

// Deliberately plain: an address, not a profile.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let lang: 'en' | 'zh' = 'en';
  let tz = DEFAULT_TIMEZONE;
  try {
    const body = (await request.json()) as {
      email?: unknown;
      lang?: unknown;
      tz?: unknown;
    };
    email = String(body.email ?? '').trim().toLowerCase();
    lang = body.lang === 'zh' ? 'zh' : 'en';
    // The browser knows the reader's zone; an absent or odd one is not worth
    // failing a signup over, so addSubscriber falls back for us.
    if (typeof body.tz === 'string' && body.tz) tz = body.tz;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), { status: 400 });
  }

  try {
    const db = env.DB as D1Database;
    await ensureSubscriberTable(db);
    await addSubscriber(db, { email, lang, tz });
  } catch (e) {
    console.error('daily-invitation: store failed:', e);
    return new Response(JSON.stringify({ ok: false, error: 'storage' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
