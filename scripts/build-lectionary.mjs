// Expands the vendored BCP Daily Office Lectionary into one dated entry per
// calendar day. Deterministic: same inputs, byte-identical output.
//
// Run: node scripts/build-lectionary.mjs
//
// The five date helpers below are duplicated from src/lib/liturgicalCalendar.ts
// rather than imported, so this runs under plain node with no type stripping.
// They are small and stable, and buildLectionary.test.ts guards them.

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = JSON.parse(
  readFileSync(new URL('./data/bcp-daily-office.json', import.meta.url), 'utf8')
);

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// ---- date helpers ----------------------------------------------------------

function parse(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day, n) {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + n);
  return format(date);
}

function weekdayIndex(day) {
  return parse(day).getUTCDay();
}

function sundayOnOrBefore(day) {
  return addDays(day, -weekdayIndex(day));
}

function sundayAfter(day) {
  return addDays(sundayOnOrBefore(day), 7);
}

function easterSunday(year) {
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

function adventFirstSunday(year) {
  return addDays(sundayOnOrBefore(`${year}-12-25`), -21);
}

function liturgicalEndingYear(day) {
  const civilYear = Number(day.slice(0, 4));
  return day >= adventFirstSunday(civilYear) ? civilYear + 1 : civilYear;
}

function officeYear(day) {
  return liturgicalEndingYear(day) % 2 === 1 ? 1 : 2;
}

/** The Sunday nearest a date; a Wednesday ties to the following Sunday. */
function sundayClosestTo(year, month, day) {
  const target = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const before = sundayOnOrBefore(target);
  const after = addDays(before, 7);
  const distBefore = (parse(target) - parse(before)) / 86400000;
  return distBefore <= 3 ? before : after;
}

// ---- week placement --------------------------------------------------------

/**
 * Map every Sunday in a civil year to the week id whose readings it opens.
 * Applied in order of increasing precedence: a season always wins over a
 * Proper that would otherwise land inside it.
 */
function placeWeeks(year) {
  const placed = new Map();
  const easter = easterSunday(year);

  const set = (sunday, id) => {
    if (SOURCE.weeks[id]) placed.set(sunday, id);
  };

  for (const [id, week] of Object.entries(SOURCE.weeks)) {
    const p = week.placement;
    if (p?.rule === 'sundayClosestTo') set(sundayClosestTo(year, p.month, p.day), id);
  }

  // Epiphany weeks run from the first Sunday after January 6.
  const epiphany1 = sundayAfter(`${year}-01-06`);
  for (let n = 1; n <= 8; n++) set(addDays(epiphany1, 7 * (n - 1)), `epiphany${n}`);
  // Last Epiphany is always the Sunday before Ash Wednesday, however many
  // numbered Epiphany weeks the year happens to have room for.
  set(addDays(easter, -49), 'epiphanylast');

  for (let n = 1; n <= 5; n++) set(addDays(easter, -42 + 7 * (n - 1)), `lent${n}`);
  set(addDays(easter, -7), 'holy-week');

  set(easter, 'easter-week');
  for (let n = 2; n <= 7; n++) set(addDays(easter, 7 * (n - 1)), `easter${n}`);

  const advent1 = adventFirstSunday(year);
  for (let n = 1; n <= 4; n++) set(addDays(advent1, 7 * (n - 1)), `advent${n}`);

  return placed;
}

// ---- named and dated holy days ---------------------------------------------

/** Where each named day in the source falls. Evening-only "Eve of" days are skipped. */
function placeNamedDays(year) {
  const easter = easterSunday(year);
  const placed = new Map();

  const set = (date, label) => {
    if (SOURCE.named[label]) placed.set(date, label);
  };

  set(`${year}-12-24`, 'Christmas Eve');
  set(`${year}-12-25`, 'Christmas Day');
  set(`${year}-01-01`, 'Holy Name');
  set(`${year}-01-06`, 'Epiphany');

  // The Sundays that fall in the twelve days of Christmas.
  const firstAfterChristmas = sundayAfter(`${year}-12-25`);
  if (firstAfterChristmas <= `${year}-12-31`) {
    set(firstAfterChristmas, 'First Sunday after Christmas');
  }
  const secondAfterChristmas = sundayAfter(`${year}-01-01`);
  if (secondAfterChristmas <= `${year}-01-05`) {
    set(secondAfterChristmas, 'Second Sunday after Christmas');
  }

  set(addDays(easter, -46), 'Ash Wednesday');
  set(addDays(easter, -7), 'Palm Sunday');
  set(addDays(easter, -3), 'Maundy Thursday');
  set(addDays(easter, -2), 'Good Friday');
  set(addDays(easter, -1), 'Holy Saturday');
  set(easter, 'Easter Day');
  set(addDays(easter, 39), 'Ascension Day');
  set(addDays(easter, 49), 'The Day of Pentecost');
  set(addDays(easter, 56), 'Trinity Sunday');

  return placed;
}

// ---- titles ----------------------------------------------------------------

// A named day stands on its own: its season is fixed, and its title takes no
// weekday prefix ("Ash Wednesday", never "Wednesday, Ash Wednesday").
const NAMED_SEASON = {
  'Christmas Eve': 'christmas',
  'Christmas Day': 'christmas',
  'Holy Name': 'christmas',
  'First Sunday after Christmas': 'christmas',
  'Second Sunday after Christmas': 'christmas',
  Epiphany: 'epiphany',
  'Ash Wednesday': 'lent',
  'Palm Sunday': 'lent',
  'Maundy Thursday': 'lent',
  'Good Friday': 'lent',
  'Holy Saturday': 'lent',
  'Easter Day': 'easter',
  'Ascension Day': 'easter',
  'The Day of Pentecost': 'pentecost',
  'Trinity Sunday': 'pentecost',
};

const NAMED_ZH = {
  'Christmas Eve': '平安夜',
  'Christmas Day': '圣诞节',
  'Holy Name': '耶稣圣名日',
  Epiphany: '主显节',
  'First Sunday after Christmas': '圣诞后第一主日',
  'Second Sunday after Christmas': '圣诞后第二主日',
  'Ash Wednesday': '圣灰星期三',
  'Palm Sunday': '棕枝主日',
  'Maundy Thursday': '设立圣餐日',
  'Good Friday': '受难日',
  'Holy Saturday': '圣周六',
  'Easter Day': '复活节',
  'Ascension Day': '升天节',
  'The Day of Pentecost': '五旬节',
  'Trinity Sunday': '三一主日',
};

const MONTH_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Footnote markers ('John 1:1-18**') are typography, not part of the reference. */
function stripFootnotes(ref) {
  return ref ? ref.replace(/[*†‡]+\s*$/, '').trim() : ref;
}

/**
 * Three references in the source do not follow its own conventions. Each is
 * corrected here, so the shipped table is uniformly parseable:
 *
 *   'Matt. 12-14-21'         a typo for 'Matt. 12:14-21'
 *   'Matt. (1:1-17); 3:1-6'  an optional genealogy before the day's reading
 *   'Luke (1:1-4); 3:1-14'   an optional prologue before the day's reading
 *
 * The parenthesised portions are the BCP's optional extensions, so the reading
 * proper is what follows the semicolon.
 */
function normalizeReference(ref) {
  if (!ref) return ref;
  let out = ref;
  // Drop a parenthesised optional passage that precedes the reading proper.
  out = out.replace(/^([1-3]?\s*[A-Za-z.]+)\s*\([^)]*\);\s*/, '$1 ');
  // Repair a chapter:verse separator typed as a dash.
  out = out.replace(/(?<![\d:])(\d+)-(\d+)-(\d+)\s*$/, '$1:$2-$3');
  return out.trim();
}

/**
 * A principal feast prints a morning and an evening set, and the gospel is
 * sometimes only in the evening one (Palm Sunday reads Luke 19:41-48 there).
 */
function gospelOf(readings) {
  if (readings.gospel) return readings.gospel;
  const evening = readings.evening ?? [];
  return evening.find((ref) => /^(Matt|Mark|Luke|John)[. ]/.test(ref)) ?? null;
}

/** The Chinese name of a week, from its id. */
function weekZh(id, label) {
  const proper = id.match(/^proper(\d+)$/);
  if (proper) return `常年期第${proper[1]}周`;
  const seasonal = id.match(/^(advent|epiphany|lent|easter)(\d+|last)$/);
  if (seasonal) {
    const season = { advent: '将临期', epiphany: '显现期', lent: '四旬期', easter: '复活期' }[
      seasonal[1]
    ];
    return seasonal[2] === 'last' ? `${season}末周` : `${season}第${seasonal[2]}周`;
  }
  if (id === 'holy-week') return '圣周';
  if (id === 'easter-week') return '复活期第1周';
  return label;
}

function seasonFor(id) {
  if (id.startsWith('advent')) return 'advent';
  if (id.startsWith('christmas')) return 'christmas';
  if (id.startsWith('epiphany')) return 'epiphany';
  if (id.startsWith('lent') || id === 'holy-week') return 'lent';
  if (id.startsWith('easter')) return 'easter';
  return 'pentecost';
}

// ---- the build -------------------------------------------------------------

export function buildDays(fromYear, toYear) {
  // Place a year either side of the window so January and December resolve.
  const weeks = new Map();
  const named = new Map();
  for (let y = fromYear - 1; y <= toYear + 1; y++) {
    for (const [date, id] of placeWeeks(y)) weeks.set(date, id);
    for (const [date, label] of placeNamedDays(y)) named.set(date, label);
  }

  const out = {};
  let day = `${fromYear}-01-01`;
  const end = `${toYear}-12-31`;

  while (day <= end) {
    const wdIndex = weekdayIndex(day);
    const weekday = WEEKDAYS[wdIndex];
    const year = officeYear(day);

    const weekId = weeks.get(sundayOnOrBefore(day));
    const week = weekId ? SOURCE.weeks[weekId] : null;

    // Precedence: a named holy day, then a day the source keys by date, then
    // the weekly table. Never emit a day with no readings.
    const namedLabel = named.get(day);
    const datedKey = day.slice(5);
    let readings = null;
    let label = null;
    let labelZh = null;
    let standalone = false;
    let season = weekId ? seasonFor(weekId) : 'pentecost';

    if (namedLabel && gospelOf(SOURCE.named[namedLabel] ?? {})) {
      readings = SOURCE.named[namedLabel];
      label = namedLabel;
      labelZh = NAMED_ZH[namedLabel] ?? namedLabel;
      season = NAMED_SEASON[namedLabel] ?? season;
      standalone = true;
    } else if (gospelOf(SOURCE.dated[datedKey] ?? {})) {
      readings = SOURCE.dated[datedKey];
      const [m, d] = datedKey.split('-').map(Number);
      label = `${MONTH_EN[m - 1]} ${d}`;
      labelZh = `${m}月${d}日`;
      season = 'christmas';
      standalone = true;
    } else if (gospelOf(week?.[year]?.[weekday] ?? {})) {
      readings = week[year][weekday];
      label = /^Proper \d+$/.test(week.label) ? `Week of ${week.label}` : week.label;
      labelZh = weekZh(weekId, week.label);
    }

    if (!readings && gospelOf(SOURCE.holyDays?.[datedKey] ?? {})) {
      // Days the seasonal tables omit because they belong to a holy day:
      // Dec 26-28 are St Stephen, St John and Holy Innocents. Used only to
      // fill a genuine gap, never to override the weekly table.
      const holy = SOURCE.holyDays[datedKey];
      readings = holy;
      label = holy.label;
      labelZh = holy.label;
      season = 'christmas';
      standalone = true;
    }

    if (!readings) {
      // A weekday displaced by a holy day whose own readings we skipped (the
      // evening-only "Eve of" entries), or a hole in the source. Carry the
      // previous day rather than emitting a day with nothing to read.
      const previous = out[addDays(day, -1)];
      if (!previous) throw new Error(`no readings for ${day} and no previous day to carry`);
      readings = previous.readings;
      label = previous.week;
      labelZh = previous.weekZh;
      season = previous.season;
    }

    out[day] = {
      season,
      week: label,
      weekZh: labelZh,
      weekday,
      officeYear: year,
      title: {
        en: standalone ? label : `${WEEKDAY_EN[wdIndex]}, ${label}`,
        zh: standalone ? labelZh : `${labelZh} ${WEEKDAY_ZH[wdIndex]}`,
      },
      readings: {
        psalmsMorning: readings.psalmsMorning ?? null,
        psalmsEvening: readings.psalmsEvening ?? null,
        ot: normalizeReference(stripFootnotes(readings.ot ?? null)),
        epistle: normalizeReference(stripFootnotes(readings.epistle ?? null)),
        gospel: normalizeReference(stripFootnotes(gospelOf(readings))),
      },
      focus: 'gospel',
    };

    day = addDays(day, 1);
  }

  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const thisYear = new Date().getUTCFullYear();
  const days = buildDays(thisYear, thisYear + 4);
  const target = new URL('../src/lib/lectionaryDays.json', import.meta.url);
  writeFileSync(target, `${JSON.stringify(days, null, 2)}\n`);
  process.stdout.write(`wrote ${Object.keys(days).length} days\n`);

  const today = new Date().toISOString().slice(0, 10);
  const remaining = Object.keys(days).filter((d) => d > today).length;
  if (remaining < 180) {
    process.stderr.write(`lectionary window has only ${remaining} days left; extend the range\n`);
    process.exit(1);
  }
}
