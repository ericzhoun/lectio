// Runtime view of the generated lectionary table. Never calls out at request
// time: the table is built from the vendored BCP Daily Office Lectionary by
// scripts/build-lectionary.mjs and committed.
import days from './lectionaryDays.json';
import type { Lang } from './reading';

export type Season = 'advent' | 'christmas' | 'epiphany' | 'lent' | 'easter' | 'pentecost';
export type ReadingSlot = 'psalmsMorning' | 'psalmsEvening' | 'ot' | 'epistle' | 'gospel';

export interface LectionaryDay {
  season: Season;
  /** The English name of the week or holy day, e.g. 'Week of Proper 17'. */
  week: string;
  weekZh: string;
  weekday: string;
  /** The BCP Daily Office runs a two-year cycle. */
  officeYear: 1 | 2;
  title: Record<Lang, string>;
  /** Readings other than the focus may be absent on a holy day. */
  readings: Record<ReadingSlot, string | null> & { gospel: string };
  focus: ReadingSlot;
}

const TABLE = days as unknown as Record<string, LectionaryDay>;

// Served when the generated window does not cover the requested day. A reader
// should still get scripture; a 500 on the daily page is never acceptable.
const FALLBACK: LectionaryDay = {
  season: 'pentecost',
  week: 'A Word for Today',
  weekZh: '今日的话',
  weekday: 'sunday',
  officeYear: 1,
  title: { en: 'A Word for Today', zh: '今日的话' },
  readings: {
    psalmsMorning: 'Psalm 63',
    psalmsEvening: 'Psalm 103',
    ot: 'Isaiah 55:1-3',
    epistle: 'Romans 8:31-39',
    gospel: 'John 15:1-11',
  },
  focus: 'gospel',
};

export function getLectionaryDay(day: string): LectionaryDay {
  const entry = TABLE[day];
  if (entry) return entry;
  console.error(
    `lectionary: no entry for ${day}; serving the fallback reading. ` +
      'Regenerate with `node scripts/build-lectionary.mjs`.'
  );
  return FALLBACK;
}

/** The single passage the six steps walk. */
export function focusReference(day: LectionaryDay): string {
  return day.readings[day.focus] ?? day.readings.gospel;
}

/** Days of coverage remaining after `today`. Zero when the table has run out. */
export function windowRemainingDays(today: string): number {
  const keys = Object.keys(TABLE);
  const last = keys[keys.length - 1];
  if (today >= last) return 0;
  const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}
