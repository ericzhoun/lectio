// First-party behavioral analytics: a single D1 table of (event, visitor,
// context) rows that page scripts and server routes append to. Events carry
// the visitor's A/B variants so any metric can be sliced by experiment arm.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { parseVariantCookie } from './ab';
import { looksLikeBot } from './botFilter';

const CREATE_EVENTS_SQL =
  'CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts DATETIME DEFAULT CURRENT_TIMESTAMP, name TEXT NOT NULL, visitor_id TEXT NOT NULL, user_id TEXT, path TEXT, lang TEXT, variants TEXT, props TEXT, referrer TEXT, ua TEXT, country TEXT)';
const CREATE_EVENTS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_analytics_name_ts ON analytics_events (name, ts)';

// Columns added after launch. The live table predates them, so every fresh
// isolate re-applies the ALTERs and swallows the duplicate-column error —
// idempotent without a migration tool, and each statement is independent so
// one success never depends on another.
const EVENT_MIGRATIONS = [
  'ALTER TABLE analytics_events ADD COLUMN referrer TEXT',
  'ALTER TABLE analytics_events ADD COLUMN ua TEXT',
  'ALTER TABLE analytics_events ADD COLUMN country TEXT',
];

const initializedDbs = new WeakSet<object>();

async function ensureEventsTable(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;
  await db.exec(CREATE_EVENTS_SQL);
  await db.exec(CREATE_EVENTS_INDEX_SQL);
  for (const migration of EVENT_MIGRATIONS) {
    try {
      await db.exec(migration);
    } catch {
      // Column already exists — the only reason this exec fails.
    }
  }
  initializedDbs.add(db);
}

// Events fired by the browser (see src/scripts/analytics.ts). The allowlist
// keeps the collect endpoint from becoming a free-form write API.
export const CLIENT_EVENT_NAMES = [
  'page_view',
  'cta_click',
  'login_overlay_open',
  'audio_play',
  'audio_error',
  'checkout_click',
] as const;
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

// Events fired by server routes, where the outcome is actually known.
// invite_subscribed: the daily-invitation email list gained a reader.
export const SERVER_EVENT_NAMES = [
  'signup_success', 'login_success', 'checkout_start', 'invite_subscribed',
] as const;

export type EventProps = Record<string, string | number | boolean | null>;

/** One normalized event row ready to insert. */
export interface AnalyticsEventRow {
  name: string;
  visitorId: string;
  userId?: string | null;
  path?: string | null;
  lang?: string | null;
  variants?: Record<string, string>;
  props?: EventProps;
}

/** Request context the browser cannot be trusted to supply honestly. */
export interface IngestContext {
  /** The page the visitor came from (client-reported document.referrer). */
  referrer?: string | null;
  /** Raw User-Agent, from the request header — also the bot signal. */
  ua?: string | null;
  /** Cloudflare's CF-IPCountry header, a two-letter code or 'XX'. */
  country?: string | null;
}

const MAX_PROPS = 10;
const MAX_KEY_LENGTH = 40;
const MAX_STRING_LENGTH = 300;
const MAX_PATH_LENGTH = 500;

function sanitizeProps(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const props: EventProps = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_PROPS) break;
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) continue;
      props[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      props[key] = value;
    } else if (typeof value === 'boolean') {
      props[key] = value;
    } else {
      continue;
    }
    count++;
  }
  return Object.keys(props).length ? JSON.stringify(props) : null;
}

/**
 * Validate and insert a client-submitted batch. Returns how many events were
 * accepted; anything malformed is dropped silently (analytics must never
 * throw into the page's way). A batch from a known crawler is refused whole:
 * headless sweeps fire real page scripts, and without this gate they read as
 * visitors (September 26 alone was one crawler posing as 164).
 */
export async function ingestClientEvents(
  db: D1Database,
  visitorId: string,
  payload: unknown,
  context: IngestContext = {}
): Promise<number> {
  if (looksLikeBot(context.ua)) return 0;
  if (!payload || typeof payload !== 'object') return 0;
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return 0;
  const batch = events.slice(0, 25);
  await ensureEventsTable(db);
  const referrer = typeof context.referrer === 'string' ? context.referrer.slice(0, MAX_PATH_LENGTH) : null;
  const country = typeof context.country === 'string' ? context.country.slice(0, 8) : null;
  const statements = [];
  for (const raw of batch) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Record<string, unknown>;
    const name = event.name;
    if (typeof name !== 'string' || !(CLIENT_EVENT_NAMES as readonly string[]).includes(name)) {
      continue;
    }
    const path = typeof event.path === 'string' ? event.path.slice(0, MAX_PATH_LENGTH) : null;
    const lang = typeof event.lang === 'string' ? event.lang.slice(0, 10) : null;
    statements.push(
      db
        .prepare(
          'INSERT INTO analytics_events (name, visitor_id, path, lang, variants, props, referrer, ua, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          name,
          visitorId,
          path,
          lang,
          JSON.stringify(event.variants ?? {}),
          sanitizeProps(event.props),
          referrer,
          context.ua ? context.ua.slice(0, MAX_STRING_LENGTH) : null,
          country
        )
    );
  }
  if (!statements.length) return 0;
  await db.batch(statements);
  return statements.length;
}

/** Fire a server-side event (outcome the browser cannot know on its own). */
export async function trackServerEvent(options: {
  name: (typeof SERVER_EVENT_NAMES)[number];
  cookies: { get: (name: string) => { value: string } | undefined };
  /** The account this event belongs to, when one exists. Left unset for
   *  anonymous outcomes (e.g. an email signup) — the visitor id already
   *  identifies the reader, and analytics stays free of addresses. */
  userId?: string;
  props?: EventProps;
  /** The route's request, when at hand: supplies UA and country columns. */
  request?: Request;
}): Promise<void> {
  const db = env.DB;
  if (!db) return;
  try {
    const ua = options.request?.headers.get('user-agent');
    if (looksLikeBot(ua)) return; // Scripts hit these routes too; they are not signups.
    await ensureEventsTable(db);
    const visitorId = options.cookies.get('vid')?.value;
    if (!visitorId) return; // No visitor context (e.g. bot POST) — skip.
    const variants = parseVariantCookie(options.cookies.get('ab')?.value);
    await db
      .prepare(
        'INSERT INTO analytics_events (name, visitor_id, user_id, variants, props, ua, country) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        options.name,
        visitorId,
        options.userId ?? null,
        JSON.stringify(variants),
        sanitizeProps(options.props),
        ua ? ua.slice(0, MAX_STRING_LENGTH) : null,
        options.request?.headers.get('cf-ipcountry')?.slice(0, 8) ?? null
      )
      .run();
  } catch (e) {
    console.error('Error tracking event:', options.name, e);
  }
}
