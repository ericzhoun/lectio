// "What day is it for this reader?" A daily practice that rolls over at the
// wrong local hour is worse than no daily practice.

export const TIMEZONE_COOKIE = 'tz';

/** The day a session is pinned to, set at /today and honoured by the steps. */
export const DAY_COOKIE = 'daily_day';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A walk opened from the verse library is pinned to a passage, not a date:
 * the session key is a pseudo-day like `verse:2-corinthians-10-2-6`. It rides
 * the same tables and steps as a dated walk, but never collides with one.
 */
export const VERSE_DAY_PREFIX = 'verse:';
export const VERSE_DAY_RE = /^verse:[a-z0-9-]+$/;

export function isVerseDay(day: string): boolean {
  return VERSE_DAY_RE.test(day);
}

/** The library slug inside a verse pseudo-day. Empty for anything else. */
export function verseSlugOfDay(day: string): string {
  return isVerseDay(day) ? day.slice(VERSE_DAY_PREFIX.length) : '';
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDay(now: Date, tz: string): string {
  // 'en-CA' formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Structural subset of the Astro page context we need, matching the approach
// in i18n.ts - keeps this module unit-testable without the full Astro types.
interface CookieContext {
  cookies: { get(name: string): { value: string } | undefined };
  /** Present on the Astro global; absent in the narrower contexts that only pass cookies. */
  url?: URL;
}

export function resolveLocalDay(astro: CookieContext, now: Date = new Date()): string {
  // A link from an email carries no cookie, so a validated ?tz= query param
  // takes precedence over the cookie - never trust it blindly, an invalid
  // value falls through to the cookie exactly as if the param were absent.
  const queryTz = astro.url?.searchParams.get('tz');
  const tz = (isValidTimeZone(queryTz) && queryTz) || astro.cookies.get(TIMEZONE_COOKIE)?.value;
  return localDay(now, isValidTimeZone(tz) ? tz : 'UTC');
}

/**
 * The day the reader is currently praying, which is not always today. Someone
 * who begins at 23:55 and reaches Oratio at 00:02 stays on the day they began;
 * otherwise their words would scatter across two sessions. A reader who opened
 * a season's own day from a reading plan is likewise walking that day.
 *
 * The pin is server-set, httpOnly and short-lived, and /today re-pins to today
 * whenever it is opened without a chosen day, so any well-formed pin is
 * honoured: it can only ever be a day this reader deliberately opened.
 */
export function resolveActiveDay(astro: CookieContext, now: Date = new Date()): string {
  const today = resolveLocalDay(astro, now);
  const pinned = astro.cookies.get(DAY_COOKIE)?.value;
  // A pin is honoured only in a shape this site sets: a date, or a verse
  // pseudo-day from a library walk. Anything else falls back to today.
  return pinned && (DAY_RE.test(pinned) || VERSE_DAY_RE.test(pinned)) ? pinned : today;
}

/**
 * A day the reader asked for by link (`/today?day=2026-12-01`), or null when
 * none was asked for. Validity against the lectionary is the caller's call:
 * this only guarantees the shape.
 */
export function requestedDay(astro: CookieContext): string | null {
  const asked = astro.url?.searchParams.get('day');
  return asked && DAY_RE.test(asked) ? asked : null;
}
