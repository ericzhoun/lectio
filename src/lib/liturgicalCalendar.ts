// Liturgical date math for the daily lectionary.
// Dates are 'YYYY-MM-DD' calendar strings throughout - never Date objects across
// a module boundary, because a Date carries a zone and a calendar day does not.

/** Parse 'YYYY-MM-DD' into a UTC-midnight Date. Internal only. */
function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date back to 'YYYY-MM-DD'. Internal only. */
function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + n);
  return format(date);
}

/** Day of week, 0 = Sunday. */
export function weekdayIndex(day: string): number {
  return parse(day).getUTCDay();
}

export function sundayOnOrBefore(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** Anonymous Gregorian computus. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return format(new Date(Date.UTC(year, month - 1, dayOfMonth)));
}

/** The fourth Sunday before Christmas Day. */
export function adventFirstSunday(year: number): string {
  const christmas = `${year}-12-25`;
  // The Sunday on or before Christmas is Advent 4; three Sundays earlier is Advent 1.
  return addDays(sundayOnOrBefore(christmas), -21);
}

export interface LiturgicalYear {
  /** The civil year the liturgical year ends in. */
  endingYear: number;
  cycle: 'A' | 'B' | 'C';
}

export function liturgicalYear(day: string): LiturgicalYear {
  const civilYear = Number(day.slice(0, 4));
  const advent = adventFirstSunday(civilYear);
  const endingYear = day >= advent ? civilYear + 1 : civilYear;
  // Year A ends in a year congruent to 1 mod 3, B to 2, C to 0.
  const cycle = (['C', 'A', 'B'] as const)[endingYear % 3];
  return { endingYear, cycle };
}
