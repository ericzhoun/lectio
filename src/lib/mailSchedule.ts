// Who gets the Daily Invitation on this hourly tick. Pure arithmetic: the
// caller supplies the clock and the rows, so the awkward cases (DST, a zone we
// cannot parse, a resend attempt within the same local day) are all testable
// without a Worker or a database.
import { isValidTimeZone } from './localDay';
import type { Lang } from './reading';

/** A reader whose browser never told us a zone still deserves a morning. */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export const SEND_HOUR = 6;

export interface Subscriber {
  email: string;
  lang: Lang;
  tz: string;
  lastSent: string | null;
}

export interface DueSubscriber extends Subscriber {
  /** The reader's own day, which is what gets written back to last_sent. */
  localDay: string;
}

export function localDayAndHour(now: Date, tz: string): { day: string; hour: number } {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  // 'en-CA' formats the date as YYYY-MM-DD; h23 keeps midnight at 0, not 24.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

export function dueNow(now: Date, subscribers: Subscriber[]): DueSubscriber[] {
  const due: DueSubscriber[] = [];
  for (const subscriber of subscribers) {
    const { day, hour } = localDayAndHour(now, subscriber.tz);
    if (hour !== SEND_HOUR) continue;
    // A string compare is correct for YYYY-MM-DD and avoids re-parsing dates.
    if (subscriber.lastSent && subscriber.lastSent >= day) continue;
    due.push({ ...subscriber, localDay: day });
  }
  return due;
}
