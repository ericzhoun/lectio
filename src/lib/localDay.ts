// "What day is it for this reader?" A daily practice that rolls over at the
// wrong local hour is worse than no daily practice.

export const TIMEZONE_COOKIE = 'tz';

/** The day a session is pinned to, set at /today and honoured by the steps. */
export const DAY_COOKIE = 'daily_day';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
}

export function resolveLocalDay(astro: CookieContext, now: Date = new Date()): string {
  const tz = astro.cookies.get(TIMEZONE_COOKIE)?.value;
  return localDay(now, isValidTimeZone(tz) ? tz : 'UTC');
}

/**
 * The day the reader is currently praying, which is not always today. Someone
 * who begins at 23:55 and reaches Oratio at 00:02 stays on the day they began;
 * otherwise their words would scatter across two sessions.
 */
export function resolveActiveDay(astro: CookieContext, now: Date = new Date()): string {
  const today = resolveLocalDay(astro, now);
  const pinned = astro.cookies.get(DAY_COOKIE)?.value;
  if (!pinned || !DAY_RE.test(pinned)) return today;
  // Honour a pin only for today or the day just past. Anything older is a
  // stale cookie, and anything ahead is nonsense.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return pinned === today || pinned === yesterday ? pinned : today;
}
