// One-off generator for scripts/data/bcp-daily-office.json - the Daily Office
// Lectionary of the 1979 US Book of Common Prayer (pp. 936-1001).
//
// The Episcopal Church has never claimed copyright in the Book of Common
// Prayer; the English text is in the public domain. This is why we use it
// rather than the Revised Common Lectionary, whose tables are a copyrighted
// compilation (Consultation on Common Texts / Augsburg Fortress, 2005)
// republished elsewhere only by permission.
//
// Run: node scripts/fetch-bcp-lectionary.mjs
//
// The source is a fixed historical document, not a feed, so this is run by
// hand and its output is committed. It is not part of `prebuild`.

import { writeFileSync } from 'node:fs';

const BASE = 'https://www.bcponline.org/DOLectionary';
const PAGES = ['Advent', 'Christmas', 'Epiphany', 'Lent', 'Easter', 'Pentecost'];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Strip tags and entities from a table cell, but preserve runs of whitespace:
 * the BCP separates its columns with runs of &nbsp;, so collapsing them would
 * destroy the only column boundary the markup has.
 */
function cellText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .trim();
}

/** Collapse runs for labels and headings, where they carry no meaning. */
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** A run of two or more spaces separates the columns the BCP prints. */
function splitColumns(text) {
  return text
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** '----------' is the BCP's mark for "no reading here". */
function orNull(value) {
  if (!value) return null;
  return /^-+$/.test(value.replace(/\s/g, '')) ? null : value;
}

/**
 * Psalms cells read '146, 147   v   111, 112, 113', where the 'v' is a
 * Wingdings glyph rendered as a lowercase v.
 */
function parsePsalms(text) {
  const parts = text.split(/\s+v\s+/);
  return {
    psalmsMorning: orNull(parts[0]?.trim() ?? ''),
    psalmsEvening: orNull(parts[1]?.trim() ?? ''),
  };
}

/** Readings cells hold OT, epistle and gospel; some holy days omit the gospel. */
function parseReadings(text) {
  const cols = splitColumns(text);
  return {
    ot: orNull(cols[0] ?? '') ?? null,
    epistle: orNull(cols[1] ?? '') ?? null,
    gospel: orNull(cols[2] ?? '') ?? null,
  };
}

/** Turn a heading into a stable id: 'Week of 1 Advent' -> 'advent1'. */
function weekId(label) {
  const proper = label.match(/^Proper (\d+)$/i);
  if (proper) return `proper${proper[1]}`;

  const seasonal = label.match(/^Week of (Last|\d+) (Advent|Epiphany|Lent|Easter)$/i);
  if (seasonal) {
    const season = seasonal[2].toLowerCase();
    const n = seasonal[1].toLowerCase();
    return `${season}${n}`;
  }

  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The BCP prints its own placement rule beside each heading. */
function parsePlacement(label, gloss) {
  const closest = gloss.match(/Sunday closest to ([A-Za-z]+)\s+(\d+)/i);
  if (closest) {
    const month = new Date(`${closest[1]} 1, 2000`).getMonth() + 1;
    return { rule: 'sundayClosestTo', month, day: Number(closest[2]) };
  }

  const seasonal = label.match(/^Week of (Last|\d+) (Advent|Epiphany|Lent|Easter)$/i);
  if (seasonal) {
    const week = seasonal[1].toLowerCase();
    return {
      rule: `${seasonal[2].toLowerCase()}Week`,
      week: week === 'last' ? 'last' : Number(week),
    };
  }

  if (/^Holy Week$/i.test(label)) return { rule: 'holyWeek' };
  // 'Easter Week' is the week beginning on Easter Day itself.
  if (/^Easter Week$/i.test(label)) return { rule: 'easterWeek', week: 1 };
  return null;
}

/** 'Dec. 29' / 'Jan. 2' -> a month and day; anything else is a named day. */
function parseDatedLabel(label) {
  // The source has typos in a couple of these labels ('Jan. 7*', 'Jan 8.'),
  // so trailing punctuation and footnote marks are tolerated.
  const m = label.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d+)\s*[.*+]*$/i
  );
  if (!m) return null;
  const month = new Date(`${m[1]} 1, 2000`).getMonth() + 1;
  return { month, day: Number(m[2]) };
}

async function fetchPage(name) {
  const res = await fetch(`${BASE}/${name}.htm`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

function parsePage(html, out) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  let currentWeek = null;
  let pendingLabel = null; // a weekday or dated row awaiting its readings row
  let pendingPsalms = null;

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length !== 2) continue;

    const leftHtml = cells[0];
    const rightHtml = cells[1];
    const left = tidy(cellText(leftHtml));
    const right = cellText(rightHtml);
    if (!left && !right) continue;

    // A heading: bold text in the right cell, with an optional italic gloss.
    if (/<strong>/i.test(rightHtml) && !left) {
      const label = tidy(cellText((rightHtml.match(/<strong>([\s\S]*?)<\/strong>/i) ?? [])[1] ?? ''));
      const gloss = tidy(cellText((rightHtml.match(/<em>([\s\S]*?)<\/em>/i) ?? [])[1] ?? ''));
      const id = weekId(label);

      if (!out.weeks[id]) {
        out.weeks[id] = {
          label,
          placement: parsePlacement(label, gloss),
          1: {},
          2: {},
        };
      }
      // A week id appears once per office year, Year One first.
      out.weeks[id].seen = (out.weeks[id].seen ?? 0) + 1;
      currentWeek = { id, year: out.weeks[id].seen === 1 ? 1 : 2 };
      pendingLabel = null;
      continue;
    }

    // A weekday or dated label in the left cell opens a two-row reading block.
    if (left && /<em>/i.test(leftHtml)) {
      pendingLabel = left;
      pendingPsalms = parsePsalms(right);
      continue;
    }

    // The row after a label carries the readings. Keyed on position, not on an
    // empty left cell: at least one row in the source has a stray backtick there.
    if (pendingLabel && currentWeek) {
      const readings = { ...pendingPsalms, ...parseReadings(right) };
      const key = pendingLabel.toLowerCase();
      const dated = parseDatedLabel(pendingLabel);

      if (WEEKDAYS.includes(key)) {
        out.weeks[currentWeek.id][currentWeek.year][key] = readings;
      } else if (dated) {
        out.dated[`${String(dated.month).padStart(2, '0')}-${String(dated.day).padStart(2, '0')}`] =
          readings;
      } else {
        out.named[pendingLabel] = readings;
      }
      pendingLabel = null;
    }
  }
}

const out = { provenance: {}, weeks: {}, dated: {}, named: {} };

for (const page of PAGES) {
  process.stdout.write(`fetching ${page}... `);
  const html = await fetchPage(page);
  parsePage(html, out);
  process.stdout.write('ok\n');
}

// `seen` is parser bookkeeping, not data.
for (const week of Object.values(out.weeks)) delete week.seen;

out.provenance = {
  source: 'The Daily Office Lectionary, The Book of Common Prayer (1979), pp. 936-1001',
  url: `${BASE}/`,
  retrieved: new Date().toISOString().slice(0, 10),
  terms:
    'The Episcopal Church has never claimed copyright in the Book of Common Prayer; ' +
    'the English text is in the public domain.',
};

const target = new URL('./data/bcp-daily-office.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

const weekCount = Object.keys(out.weeks).length;
const datedCount = Object.keys(out.dated).length;
const namedCount = Object.keys(out.named).length;
process.stdout.write(`wrote ${weekCount} weeks, ${datedCount} dated days, ${namedCount} named days\n`);

// Report gaps rather than silently shipping them. Some are expected: in the
// Christmas and Epiphany seasons the BCP keys days by date rather than by
// weekday, and a handful of weekdays are displaced by a named holy day
// (Christmas Eve, Ash Wednesday, Palm Sunday, the Triduum). Those live in
// `dated` and `named`, and the generator layers them over the weekly table.
const DATED_SECTIONS = [
  'christmas-day-and-following',
  'the-epiphany-and-following',
  'the-season-after-pentecost', // a section heading, not a week
];
const EXPECTED_SUBSTITUTIONS = new Set([
  'advent4:saturday',       // Christmas Eve
  'epiphanylast:wednesday', // Ash Wednesday
  'holy-week:sunday',       // Palm Sunday
  'holy-week:thursday',     // Maundy Thursday
  'holy-week:friday',       // Good Friday
  'holy-week:saturday',     // Holy Saturday
  'easter-week:sunday',     // Easter Day
  'easter6:thursday',       // Ascension Day
  // Propers 1 and 2 fall before Pentecost, so the source prints no Sunday for
  // them; those Sundays take Epiphany-season readings.
  'proper1:sunday',
  'proper2:sunday',
]);

const gaps = [];
for (const [id, week] of Object.entries(out.weeks)) {
  if (DATED_SECTIONS.includes(id)) continue;
  if (!week.placement) gaps.push(`${id}: no placement rule`);
  for (const year of ['1', '2']) {
    for (const day of WEEKDAYS) {
      if (EXPECTED_SUBSTITUTIONS.has(`${id}:${day}`)) continue;
      const r = week[year][day];
      if (!r) gaps.push(`${id} Y${year} ${day}: missing`);
      else if (!r.gospel) gaps.push(`${id} Y${year} ${day}: no gospel`);
    }
  }
}

if (gaps.length) {
  process.stdout.write(`${gaps.length} unexpected gaps:\n${gaps.slice(0, 40).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('no unexpected gaps\n');
}
