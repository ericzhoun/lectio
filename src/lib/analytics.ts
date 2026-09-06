// First-party behavioral analytics: a single D1 table of (event, visitor,
// context) rows that page scripts and server routes append to. Events carry
// the visitor's A/B variants so any metric can be sliced by experiment arm.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { parseVariantCookie } from './ab';

const CREATE_EVENTS_SQL =
  'CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts DATETIME DEFAULT CURRENT_TIMESTAMP, name TEXT NOT NULL, visitor_id TEXT NOT NULL, user_id TEXT, path TEXT, lang TEXT, variants TEXT, props TEXT)';
const CREATE_EVENTS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_analytics_name_ts ON analytics_events (name, ts)';

const initializedDbs = new WeakSet<object>();

async function ensureEventsTable(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;
  await db.exec(CREATE_EVENTS_SQL);
  await db.exec(CREATE_EVENTS_INDEX_SQL);
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
export const SERVER_EVENT_NAMES = ['signup_success', 'login_success', 'checkout_start'] as const;

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
 * throw into the page's way).
 */
export async function ingestClientEvents(
  db: D1Database,
  visitorId: string,
  payload: unknown
): Promise<number> {
  if (!payload || typeof payload !== 'object') return 0;
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return 0;
  const batch = events.slice(0, 25);
  await ensureEventsTable(db);
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
          'INSERT INTO analytics_events (name, visitor_id, path, lang, variants, props) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(
          name,
          visitorId,
          path,
          lang,
          JSON.stringify(event.variants ?? {}),
          sanitizeProps(event.props)
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
  userId: string;
  props?: EventProps;
}): Promise<void> {
  const db = env.DB;
  if (!db) return;
  try {
    await ensureEventsTable(db);
    const visitorId = options.cookies.get('vid')?.value;
    if (!visitorId) return; // No visitor context (e.g. bot POST) — skip.
    const variants = parseVariantCookie(options.cookies.get('ab')?.value);
    await db
      .prepare(
        'INSERT INTO analytics_events (name, visitor_id, user_id, variants, props) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        options.name,
        visitorId,
        options.userId,
        JSON.stringify(variants),
        sanitizeProps(options.props)
      )
      .run();
  } catch (e) {
    console.error('Error tracking event:', options.name, e);
  }
}
