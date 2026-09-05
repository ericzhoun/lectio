# Daily Lectionary Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dated daily scripture reading, drawn from the Revised Common Lectionary and staged through the six movements of Lectio Divina, where the model responds to what the user writes.

**Architecture:** A build-time generator expands RCL source tables into a dated JSON file committed to the repo, so no external call happens at request time. `/today` redirects into one server-rendered page per step; each step POSTs to itself, saves to D1, and redirects to the next. Three of the six steps take user writing and call the model; the rest are silent by design.

**Tech Stack:** Astro 7 (SSR, `@astrojs/cloudflare`), Cloudflare Workers + D1, TypeScript, vitest, OpenAI SDK.

**Spec:** `docs/superpowers/specs/2026-09-04-daily-lectionary-design.md`

## Global Constraints

- Node 22.12+. All new scripts are ESM `.mjs` under `scripts/`, matching `scripts/fetch-bible-context.mjs`.
- Two languages only: `Lang = 'zh' | 'en'` from `src/lib/reading.ts`. Every user-visible string needs both.
- Scripture text is public domain only: WEB for `en`, 和合本 for `zh`. Never hand-edit verse text.
- No em dashes in any file you write. Use a plain `-`.
- D1 tables self-create via the `ensureTable` pattern in `src/lib/db.ts`; there is no migration system in this repo.
- New lib modules go in `src/lib/`, their tests in `src/lib/__tests__/<module>.test.ts`. Tests run in the `node` environment with `cloudflare:workers` aliased to `src/lib/__mocks__/cloudflare-workers.ts`; never make a live network or OpenAI call in a test.
- Use `D1Memory` from `src/lib/__tests__/helpers/d1-memory.ts` for anything touching D1.
- Run the full suite with `npm test` (vitest run). A single file: `npx vitest run src/lib/__tests__/<file>.test.ts`.
- Do not modify the existing draw flow (`src/pages/index.astro`, `scripture.ts`, `entitlements.ts` behaviour). The daily reading is additive.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`). Never add a co-author trailer.

## File Structure

**Created:**
- `src/lib/liturgicalCalendar.ts` - pure date math: Easter, Advent, liturgical year and cycle, season and week. No I/O.
- `src/lib/lectionary.ts` - reads the generated day table, resolves today's entry, applies the missing-date fallback.
- `src/lib/lectionaryDays.json` - generated, committed. Dated entries for the rolling window.
- `src/lib/localDay.ts` - timezone validation and "what local day is it for this user".
- `src/lib/dailySession.ts` - D1 tables, session upsert, step entries, the furthest-step guard.
- `src/lib/dailyReflection.ts` - the per-step model contract.
- `src/lib/dailySteps.ts` - the step list, order, and per-step copy in both languages.
- `scripts/build-lectionary.mjs` - expands vendored RCL source into `lectionaryDays.json`.
- `scripts/data/rcl-source.json` - vendored RCL reference tables, committed with provenance.
- `src/pages/today/index.astro` - entry point; resolves day, ensures session, redirects.
- `src/pages/today/[step].astro` - all six step screens.
- `src/pages/today/amen.astro` - closing summary, also serves past days.
- `src/components/DailyProgress.astro` - the step rail and percent complete.

**Modified:**
- `scripts/fetch-bible-context.mjs` - additionally fetch chapters the lectionary window needs.
- `src/lib/db.ts` - nothing structural; new tables live in `dailySession.ts` following the same pattern.
- `src/pages/history/index.astro` - list daily sessions beside draws.
- `package.json` - add the lectionary build to `prebuild`.
- `README.md` - document the new module, script, and tables.

---

### Task 1: Liturgical date math

Pure functions, no data files, no I/O. Everything downstream depends on these being right, so they get their own task and their own tests.

**Files:**
- Create: `src/lib/liturgicalCalendar.ts`
- Test: `src/lib/__tests__/liturgicalCalendar.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `easterSunday(year: number): string`, `adventFirstSunday(year: number): string`, `liturgicalYear(day: string): { endingYear: number; cycle: 'A' | 'B' | 'C' }`, `sundayOnOrBefore(day: string): string`, `addDays(day: string, n: number): string`. All dates are `'YYYY-MM-DD'` strings, treated as calendar dates with no time or zone.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/liturgicalCalendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  easterSunday, adventFirstSunday, liturgicalYear, sundayOnOrBefore, addDays,
} from '../liturgicalCalendar';

describe('easterSunday', () => {
  it('matches known Gregorian Easter dates', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2030)).toBe('2030-04-21');
  });
});

describe('adventFirstSunday', () => {
  it('is the fourth Sunday before Christmas', () => {
    expect(adventFirstSunday(2025)).toBe('2025-11-30');
    expect(adventFirstSunday(2026)).toBe('2026-11-29');
    expect(adventFirstSunday(2027)).toBe('2027-11-28');
  });
});

describe('liturgicalYear', () => {
  it('rolls the cycle at Advent, not at New Year', () => {
    // Day before Advent 2026 still belongs to the year ending in 2026.
    expect(liturgicalYear('2026-11-28')).toEqual({ endingYear: 2026, cycle: 'B' });
    // Advent 2026 starts the year ending in 2027.
    expect(liturgicalYear('2026-11-29')).toEqual({ endingYear: 2027, cycle: 'C' });
    // January stays in the year that began the previous Advent.
    expect(liturgicalYear('2027-01-10')).toEqual({ endingYear: 2027, cycle: 'C' });
  });

  it('assigns A/B/C by the ending year modulo 3', () => {
    expect(liturgicalYear('2023-01-01').cycle).toBe('A'); // 2023 % 3 === 1
    expect(liturgicalYear('2024-01-01').cycle).toBe('B'); // 2024 % 3 === 2
    expect(liturgicalYear('2025-01-01').cycle).toBe('C'); // 2025 % 3 === 0
  });
});

describe('sundayOnOrBefore', () => {
  it('returns the day itself when it is already Sunday', () => {
    expect(sundayOnOrBefore('2026-09-06')).toBe('2026-09-06');
  });

  it('walks back to the preceding Sunday otherwise', () => {
    expect(sundayOnOrBefore('2026-09-04')).toBe('2026-08-30');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/liturgicalCalendar.test.ts`
Expected: FAIL - cannot resolve `../liturgicalCalendar`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/liturgicalCalendar.ts`:

```ts
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
function weekday(day: string): number {
  return parse(day).getUTCDay();
}

export function sundayOnOrBefore(day: string): string {
  return addDays(day, -weekday(day));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/liturgicalCalendar.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liturgicalCalendar.ts src/lib/__tests__/liturgicalCalendar.test.ts
git commit -m "feat: liturgical date math for the daily lectionary"
```

---

### Task 2: Vendor the RCL source table

The generator needs reference data. This task only lands the source file and its provenance, so a reviewer can check licensing independently of any code.

**Files:**
- Create: `scripts/data/rcl-source.json`
- Create: `scripts/data/README.md`

**Interfaces:**
- Produces: `scripts/data/rcl-source.json` with this exact shape, consumed by Task 3.

```jsonc
{
  "provenance": { "source": "...", "url": "...", "retrieved": "2026-09-04", "terms": "..." },
  "sundays": {
    // key: liturgical day id, stable across years
    "proper17": {
      "title": { "en": "Proper 17", "zh": "常年期" },
      "A": { "first": "Exodus 3:1-15", "psalm": "Psalm 105:1-6", "gospel": "Matthew 16:21-28" },
      "B": { "first": "Song of Solomon 2:8-13", "psalm": "Psalm 45:1-2", "gospel": "Mark 7:1-8" },
      "C": { "first": "Jeremiah 2:4-13", "psalm": "Psalm 81:1", "gospel": "Luke 14:1, 7-14" }
    }
  },
  "placement": {
    // how each Sunday id is located in the year
    "proper17": { "rule": "sundayBetween", "from": "08-28", "to": "09-03" },
    "easter": { "rule": "easterOffset", "offset": 0 },
    "advent1": { "rule": "adventOffset", "offset": 0 }
  }
}
```

- [ ] **Step 1: Obtain the source table**

The Revised Common Lectionary reference tables are published by the Consultation on Common Texts and republished by the Vanderbilt Divinity Library. Download the tables for years A, B and C.

**Before committing, confirm the redistribution terms of the specific source you used and record them verbatim in `provenance.terms`.** Only the scripture *references* are needed here, never any translation's text. If the terms of your chosen source do not permit redistribution, find another source; do not proceed with an unclear license.

- [ ] **Step 2: Convert to the shape above**

Write the conversion however you like - it is a one-time job and the script is not a deliverable. What is committed is `scripts/data/rcl-source.json`, hand-checked.

Cover, at minimum: Advent 1-4, Christmas Day, Epiphany, Baptism of the Lord, Lent 1-5, Palm Sunday, Easter, Easter 2-7, Pentecost, Trinity, Propers 1-29, Christ the King. Every entry needs all three cycles and a `placement` rule.

- [ ] **Step 3: Write the provenance note**

Create `scripts/data/README.md` recording where `rcl-source.json` came from, when, the licence, and the instruction that it is regenerated by hand rather than by a script.

- [ ] **Step 4: Verify the file parses and is complete**

Run:

```bash
node -e "const d=require('./scripts/data/rcl-source.json');const ids=Object.keys(d.sundays);const missingPlacement=ids.filter(i=>!d.placement[i]);const missingCycle=ids.filter(i=>!d.sundays[i].A||!d.sundays[i].B||!d.sundays[i].C);console.log({count:ids.length,missingPlacement,missingCycle});"
```

Expected: a count of at least 60, and both arrays empty.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/rcl-source.json scripts/data/README.md
git commit -m "chore: vendor Revised Common Lectionary reference tables"
```

---

### Task 3: Generate the dated day table

Expands the source table into one entry per calendar day for a rolling window. Weekdays inherit from their Sunday: the RCL's daily readings are keyed to the adjacent Sunday, so a weekday's focus passage is that Sunday's gospel until we have a fuller daily table. This keeps the passage stable for a week at a time, which is defensible practice, and the entry shape does not change if a true daily table is added later.

**Files:**
- Create: `scripts/build-lectionary.mjs`
- Create: `src/lib/lectionaryDays.json` (generated output, committed)
- Test: `src/lib/__tests__/buildLectionary.test.ts`
- Modify: `package.json` (the `prebuild` script)

**Interfaces:**
- Consumes: `scripts/data/rcl-source.json` from Task 2; `easterSunday`, `adventFirstSunday`, `sundayOnOrBefore`, `addDays`, `liturgicalYear` from Task 1.
- Produces: `src/lib/lectionaryDays.json`, a flat object keyed `'YYYY-MM-DD'`, each value matching `LectionaryDay` as defined in Task 4:

```jsonc
{ "2026-09-04": {
    "season": "ordinary", "week": 22, "weekday": "friday",
    "title": { "en": "Friday, Week 22 in Ordinary Time", "zh": "常年期第二十二周 星期五" },
    "readings": { "first": "Colossians 1:15-20", "psalm": "Psalm 100", "gospel": "Luke 5:33-39" },
    "focus": "gospel" } }
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/buildLectionary.test.ts`. It runs the generator in-process rather than shelling out, so export the builder as well as running it from the CLI.

```ts
import { describe, it, expect } from 'vitest';
import { buildDays } from '../../../scripts/build-lectionary.mjs';

const days = buildDays(2026, 2030);

describe('buildDays', () => {
  it('emits an entry for every day in the window', () => {
    const keys = Object.keys(days);
    expect(keys[0]).toBe('2026-01-01');
    expect(keys[keys.length - 1]).toBe('2030-12-31');
    // 5 years, one leap year (2028).
    expect(keys.length).toBe(365 * 5 + 1);
  });

  it('gives every entry both languages and a resolvable focus', () => {
    for (const [day, entry] of Object.entries(days)) {
      expect(entry.title.en, day).toBeTruthy();
      expect(entry.title.zh, day).toBeTruthy();
      expect(entry.readings[entry.focus], day).toBeTruthy();
    }
  });

  it('places Easter and Advent correctly', () => {
    expect(days['2026-04-05'].season).toBe('easter');
    expect(days['2026-04-05'].title.en).toContain('Easter');
    expect(days['2026-11-29'].season).toBe('advent');
    expect(days['2026-11-29'].week).toBe(1);
  });

  it('carries a weekday to its preceding Sunday reading', () => {
    // 2026-09-04 is a Friday; 2026-08-30 is the Sunday it inherits from.
    expect(days['2026-09-04'].readings).toEqual(days['2026-08-30'].readings);
    expect(days['2026-09-04'].weekday).toBe('friday');
    expect(days['2026-08-30'].weekday).toBe('sunday');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildDays(2026, 2030))).toBe(JSON.stringify(days));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/buildLectionary.test.ts`
Expected: FAIL - cannot resolve `scripts/build-lectionary.mjs`.

- [ ] **Step 3: Write the generator**

Create `scripts/build-lectionary.mjs`. Export `buildDays` for the test; run it from the CLI when invoked directly.

```js
// Expands the vendored RCL tables into one dated entry per calendar day.
// Deterministic: same inputs, byte-identical output. Regenerate with
//   node scripts/build-lectionary.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  easterSunday, adventFirstSunday, sundayOnOrBefore, addDays, liturgicalYear,
} from '../src/lib/liturgicalCalendar.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = JSON.parse(readFileSync(join(here, 'data/rcl-source.json'), 'utf8'));
const OUT = join(here, '../src/lib/lectionaryDays.json');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** Resolve every Sunday id to its date within one civil year. */
function placeSundays(year) {
  const placed = new Map(); // date -> sunday id
  for (const [id, rule] of Object.entries(SOURCE.placement)) {
    let date;
    if (rule.rule === 'easterOffset') {
      date = addDays(easterSunday(year), rule.offset);
    } else if (rule.rule === 'adventOffset') {
      date = addDays(adventFirstSunday(year), rule.offset);
    } else if (rule.rule === 'sundayBetween') {
      // The Sunday falling in the inclusive window from..to.
      const from = `${year}-${rule.from}`;
      const to = `${year}-${rule.to}`;
      date = sundayOnOrBefore(to);
      if (date < from) continue; // no Sunday in the window this year
    } else {
      throw new Error(`unknown placement rule for ${id}: ${rule.rule}`);
    }
    // Later rules never overwrite earlier ones; the source order is the priority order.
    if (!placed.has(date)) placed.set(date, id);
  }
  return placed;
}

function seasonFor(id) {
  if (id.startsWith('advent')) return 'advent';
  if (id.startsWith('christmas') || id === 'epiphany') return 'christmas';
  if (id.startsWith('lent') || id === 'palmSunday') return 'lent';
  if (id === 'easter' || id.startsWith('easter')) return 'easter';
  return 'ordinary';
}

function weekFor(id) {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : 1;
}

function titleFor(sunday, weekdayIndex, lang) {
  const base = sunday.title[lang];
  if (weekdayIndex === 0) return base;
  return lang === 'en'
    ? `${WEEKDAYS[weekdayIndex][0].toUpperCase()}${WEEKDAYS[weekdayIndex].slice(1)}, ${base}`
    : `${base} ${WEEKDAY_ZH[weekdayIndex]}`;
}

export function buildDays(fromYear, toYear) {
  // Place Sundays for one year either side of the window so January and
  // December inherit correctly.
  const placed = new Map();
  for (let y = fromYear - 1; y <= toYear + 1; y++) {
    for (const [date, id] of placeSundays(y)) placed.set(date, id);
  }

  const out = {};
  let day = `${fromYear}-01-01`;
  const end = `${toYear}-12-31`;
  while (day <= end) {
    const sundayDate = sundayOnOrBefore(day);
    const id = placed.get(sundayDate);
    if (!id) throw new Error(`no lectionary Sunday placed for ${sundayDate}`);
    const sunday = SOURCE.sundays[id];
    if (!sunday) throw new Error(`placement references unknown Sunday id: ${id}`);
    const { cycle } = liturgicalYear(day);
    const readings = sunday[cycle];
    const weekdayIndex = WEEKDAYS.indexOf(
      WEEKDAYS[(new Date(`${day}T00:00:00Z`)).getUTCDay()]
    );
    out[day] = {
      season: seasonFor(id),
      week: weekFor(id),
      weekday: WEEKDAYS[weekdayIndex],
      title: {
        en: titleFor(sunday, weekdayIndex, 'en'),
        zh: titleFor(sunday, weekdayIndex, 'zh'),
      },
      readings,
      focus: 'gospel',
    };
    day = addDays(day, 1);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const thisYear = new Date().getUTCFullYear();
  const days = buildDays(thisYear, thisYear + 4);
  writeFileSync(OUT, `${JSON.stringify(days, null, 2)}\n`);
  console.log(`wrote ${Object.keys(days).length} days to ${OUT}`);
}
```

Note the `.ts` import: vitest resolves it, and the CLI path needs Node's type stripping, which 22.12 provides behind `--experimental-strip-types`. If the bare `node scripts/build-lectionary.mjs` invocation fails on the import, the fix is to inline the five date helpers into the script rather than to add a build step - they are small, and duplicating them is cheaper than a toolchain.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/buildLectionary.test.ts`
Expected: PASS, 5 tests. If the "every entry has a resolvable focus" test fails, `rcl-source.json` is missing a gospel for some cycle - fix the data, not the test.

- [ ] **Step 5: Generate the committed output**

Run: `node scripts/build-lectionary.mjs`
Expected: `wrote 1826 days to .../src/lib/lectionaryDays.json`

- [ ] **Step 6: Wire into prebuild**

In `package.json`, change:

```json
"prebuild": "node scripts/generate-sitemap.mjs",
```

to:

```json
"prebuild": "node scripts/build-lectionary.mjs && node scripts/generate-sitemap.mjs",
```

- [ ] **Step 7: Commit**

```bash
git add scripts/build-lectionary.mjs src/lib/lectionaryDays.json src/lib/__tests__/buildLectionary.test.ts package.json
git commit -m "feat: generate dated lectionary day table"
```

---

### Task 4: Lectionary reader and fallback

The runtime view of the generated table. Kept separate from the generator so the app never imports build code.

**Files:**
- Create: `src/lib/lectionary.ts`
- Test: `src/lib/__tests__/lectionary.test.ts`

**Interfaces:**
- Consumes: `src/lib/lectionaryDays.json` from Task 3.
- Produces:

```ts
export type Season = 'advent' | 'christmas' | 'lent' | 'easter' | 'ordinary';
export type ReadingSlot = 'first' | 'psalm' | 'gospel';
export interface LectionaryDay {
  season: Season;
  week: number;
  weekday: string;
  title: Record<Lang, string>;
  readings: Record<ReadingSlot, string>;
  focus: ReadingSlot;
}
export function getLectionaryDay(day: string): LectionaryDay;
export function focusReference(day: LectionaryDay): string;
export function windowRemainingDays(today: string): number;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/lectionary.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLectionaryDay, focusReference, windowRemainingDays } from '../lectionary';

afterEach(() => vi.restoreAllMocks());

describe('getLectionaryDay', () => {
  it('returns the generated entry for a date in the window', () => {
    const day = getLectionaryDay('2026-09-04');
    expect(day.title.en).toBeTruthy();
    expect(day.title.zh).toBeTruthy();
    expect(day.readings.gospel).toBeTruthy();
  });

  it('falls back rather than throwing for a date outside the window', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const day = getLectionaryDay('1999-01-01');
    expect(day.readings[day.focus]).toBeTruthy();
    expect(day.title.en).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });
});

describe('focusReference', () => {
  it('returns the reading named by focus', () => {
    const day = getLectionaryDay('2026-09-04');
    expect(focusReference(day)).toBe(day.readings[day.focus]);
  });
});

describe('windowRemainingDays', () => {
  it('counts days left in the generated table', () => {
    expect(windowRemainingDays('2026-09-04')).toBeGreaterThan(180);
  });

  it('is zero past the end of the table', () => {
    expect(windowRemainingDays('2099-01-01')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/lectionary.test.ts`
Expected: FAIL - cannot resolve `../lectionary`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/lectionary.ts`:

```ts
// Runtime view of the generated lectionary table. Never calls out at request time.
import days from './lectionaryDays.json';
import type { Lang } from './reading';

export type Season = 'advent' | 'christmas' | 'lent' | 'easter' | 'ordinary';
export type ReadingSlot = 'first' | 'psalm' | 'gospel';

export interface LectionaryDay {
  season: Season;
  week: number;
  weekday: string;
  title: Record<Lang, string>;
  readings: Record<ReadingSlot, string>;
  focus: ReadingSlot;
}

const TABLE = days as Record<string, LectionaryDay>;

// Used when the generated window does not cover the requested day. A reader
// should still get scripture; a 500 on the daily page is never acceptable.
const FALLBACK: LectionaryDay = {
  season: 'ordinary',
  week: 1,
  weekday: 'sunday',
  title: { en: 'A Word for Today', zh: '今日的话' },
  readings: {
    first: 'Isaiah 55:1-3',
    psalm: 'Psalm 23',
    gospel: 'John 15:1-11',
  },
  focus: 'gospel',
};

export function getLectionaryDay(day: string): LectionaryDay {
  const entry = TABLE[day];
  if (entry) return entry;
  console.error(
    `lectionary: no entry for ${day}; serving fallback. Regenerate with ` +
      '`node scripts/build-lectionary.mjs`.'
  );
  return FALLBACK;
}

export function focusReference(day: LectionaryDay): string {
  return day.readings[day.focus];
}

/** Days of coverage remaining after `today`. Zero when the table has run out. */
export function windowRemainingDays(today: string): number {
  const keys = Object.keys(TABLE);
  const last = keys[keys.length - 1];
  if (today >= last) return 0;
  const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/lectionary.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the coverage guard to the build**

Append to `scripts/build-lectionary.mjs`, inside the CLI block after writing:

```js
  const today = new Date().toISOString().slice(0, 10);
  const remaining = Object.keys(days).filter((d) => d > today).length;
  if (remaining < 180) {
    console.error(`lectionary window has only ${remaining} days left; extend the range`);
    process.exit(1);
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/lectionary.ts src/lib/__tests__/lectionary.test.ts scripts/build-lectionary.mjs
git commit -m "feat: lectionary reader with out-of-window fallback"
```

---

### Task 5: Passage text coverage

The reader resolves a reference like `Luke 5:33-39` to text. `bibleChapters.json` currently only holds chapters the 148-verse deck touches, so it must grow. **Measure before choosing where the data lives.**

**Files:**
- Modify: `scripts/fetch-bible-context.mjs`
- Create: `src/lib/passage.ts`
- Test: `src/lib/__tests__/passage.test.ts`

**Interfaces:**
- Consumes: `getLectionaryDay`, `focusReference` from Task 4; the existing chapter store.
- Produces: `resolvePassage(ref: string, lang: Lang): { ref: string; text: string } | null` and `parseReference(ref: string): { book: string; chapter: number; from: number; to: number } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/passage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseReference, resolvePassage } from '../passage';
import { getLectionaryDay, focusReference } from '../lectionary';
import lectionaryDays from '../lectionaryDays.json';

describe('parseReference', () => {
  it('parses a verse range', () => {
    expect(parseReference('Luke 5:33-39')).toEqual({
      book: 'Luke', chapter: 5, from: 33, to: 39,
    });
  });

  it('parses a single verse', () => {
    expect(parseReference('John 3:16')).toEqual({
      book: 'John', chapter: 3, from: 16, to: 16,
    });
  });

  it('parses a numbered book', () => {
    expect(parseReference('1 Corinthians 13:1-3')).toEqual({
      book: '1 Corinthians', chapter: 13, from: 1, to: 3,
    });
  });

  it('returns null for junk', () => {
    expect(parseReference('not a reference')).toBeNull();
  });
});

describe('resolvePassage', () => {
  it('returns joined verse text in both languages', () => {
    const en = resolvePassage('Luke 5:33-39', 'en');
    const zh = resolvePassage('Luke 5:33-39', 'zh');
    expect(en?.text.length).toBeGreaterThan(50);
    expect(zh?.text.length).toBeGreaterThan(20);
  });

  it('resolves every focus reading in the generated window', () => {
    const unresolved: string[] = [];
    for (const day of Object.keys(lectionaryDays)) {
      const ref = focusReference(getLectionaryDay(day));
      if (!resolvePassage(ref, 'en')) unresolved.push(`${day}: ${ref}`);
    }
    expect(unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/passage.test.ts`
Expected: FAIL - cannot resolve `../passage`.

- [ ] **Step 3: Extend the chapter fetcher**

Read `scripts/fetch-bible-context.mjs` first and follow its existing structure. Add a second source of required chapters: import `src/lib/lectionaryDays.json`, collect every `readings[focus]`, parse each to a book and chapter, and union that set with the chapters the deck already needs. Do not change how it fetches or how it writes.

Run it: `node scripts/fetch-bible-context.mjs`

- [ ] **Step 4: Measure the result and decide**

Run: `ls -l src/lib/bibleChapters.json`

If the file is **under 3 MB**, keep the bundled import and continue to Step 5.

If it is **3 MB or larger**, stop and move chapter text to KV before continuing: add a `CHAPTERS` KV binding in `wrangler.jsonc`, upload the chapters from the script, and have `resolvePassage` become async, reading from KV with an in-request cache. This is a real fork in the plan. It is cheap now and expensive after the pages are written, which is why it is measured here rather than assumed.

Record which branch you took in the commit message.

- [ ] **Step 5: Export and complete the book-number map**

`src/lib/scripture.ts:90` holds `BOOK_NR`, a book-name to getbible-number map. It is module-private and **incomplete** - it was only ever built for the 148-verse deck. These entries are missing and the lectionary needs them:

```ts
  'Song of Solomon': 22, Habakkuk: 35, Haggai: 37, '2 John': 63, '3 John': 64,
```

Add them, and change the declaration to `export const BOOK_NR`. Nothing else in `scripture.ts` changes.

`scripts/fetch-bible-context.mjs:25` has its own copy of the same map. Add the same five entries there too, or the fetcher will throw `Unknown book` on the lectionary chapters.

- [ ] **Step 6: Write the implementation**

Chapter data is keyed `'<bookNumber>:<chapter>'` with zero-indexed verse arrays: `{ en: string[]; zh: string[] }`. See `src/lib/scripture.ts:157`.

Create `src/lib/passage.ts`:

```ts
// Resolve a lectionary reference like 'Luke 5:33-39' to public-domain text.
import bibleChapters from './bibleChapters.json';
import { BOOK_NR } from './scripture';
import type { Lang } from './reading';

export interface ParsedReference {
  book: string;
  chapter: number;
  from: number;
  to: number;
}

export interface ResolvedPassage {
  ref: string;
  text: string;
}

// Book names may carry a leading numeral and internal spaces ('Song of Solomon',
// '1 Corinthians'), so the book group is non-greedy up to the chapter number.
const REFERENCE_RE = /^\s*((?:[1-3]\s+)?[A-Za-z][A-Za-z\s]*?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?\s*$/;

const CHAPTERS = bibleChapters as Record<string, { en: string[]; zh: string[] }>;

export function parseReference(ref: string): ParsedReference | null {
  const m = REFERENCE_RE.exec(ref);
  if (!m) return null;
  const from = Number(m[3]);
  const to = m[4] ? Number(m[4]) : from;
  if (to < from) return null;
  return { book: m[1].trim().replace(/\s+/g, ' '), chapter: Number(m[2]), from, to };
}

export function resolvePassage(ref: string, lang: Lang): ResolvedPassage | null {
  const parsed = parseReference(ref);
  if (!parsed) return null;

  const nr = BOOK_NR[parsed.book];
  if (!nr) return null;

  const chapter = CHAPTERS[`${nr}:${parsed.chapter}`];
  if (!chapter) return null;

  const verses = lang === 'zh' ? chapter.zh : chapter.en;
  // Verse numbers are 1-based; the stored arrays are 0-indexed.
  const slice = verses.slice(parsed.from - 1, parsed.to);
  // A short slice means the range runs past the end of the chapter. Render
  // nothing rather than half a passage - the caller has a fallback.
  if (slice.length !== parsed.to - parsed.from + 1) return null;
  if (slice.some((v) => !v)) return null;

  return { ref, text: slice.join(' ') };
}
```

Lectionary references sometimes carry a comma-separated range (`Luke 14:1, 7-14`). `parseReference` returns null for those, so the "resolves every focus reading" test will list them. Fix them in `rcl-source.json` by widening to the contiguous span (`Luke 14:1-14`) rather than complicating the parser - a couple of extra verses in a contemplative reading is not a problem worth a second grammar.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/passage.test.ts`
Expected: PASS, 6 tests. The "resolves every focus reading" test is the important one - if it lists unresolved references, the fetcher missed chapters, `BOOK_NR` is still missing a book, or a reference in `rcl-source.json` uses a comma range.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-bible-context.mjs src/lib/bibleChapters.json src/lib/scripture.ts src/lib/passage.ts src/lib/__tests__/passage.test.ts
git commit -m "feat: resolve lectionary references to passage text"
```

---

### Task 6: Local day resolution

**Files:**
- Create: `src/lib/localDay.ts`
- Test: `src/lib/__tests__/localDay.test.ts`

**Interfaces:**
- Produces: `TIMEZONE_COOKIE = 'tz'`, `DAY_COOKIE = 'daily_day'`, `isValidTimeZone(tz: unknown): tz is string`, `localDay(now: Date, tz: string): string`, `resolveLocalDay(astro: CookieContext, now?: Date): string`, `resolveActiveDay(astro: CookieContext, now?: Date): string`.

`resolveActiveDay` is what the step pages use. A reader who starts at 23:55 and submits Oratio at 00:02 must stay on the day they started, so the day is pinned in a cookie at `/today` and honoured for the rest of that session. `resolveLocalDay` is the raw "what day is it now" and is only used when starting a session.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/localDay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isValidTimeZone, localDay, resolveLocalDay, resolveActiveDay,
  TIMEZONE_COOKIE, DAY_COOKIE,
} from '../localDay';

const ctx = (tz?: string, pinnedDay?: string) => ({
  cookies: {
    get: (n: string) => {
      if (n === TIMEZONE_COOKIE && tz) return { value: tz };
      if (n === DAY_COOKIE && pinnedDay) return { value: pinnedDay };
      return undefined;
    },
  },
});

describe('isValidTimeZone', () => {
  it('accepts a real zone', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
  });

  it('rejects junk and non-strings', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('localDay', () => {
  it('is ahead of UTC in an eastern zone', () => {
    // 23:30 UTC is already the next day in Shanghai (UTC+8).
    const now = new Date('2026-09-04T23:30:00Z');
    expect(localDay(now, 'UTC')).toBe('2026-09-04');
    expect(localDay(now, 'Asia/Shanghai')).toBe('2026-09-05');
  });

  it('is behind UTC in a western zone', () => {
    const now = new Date('2026-09-04T02:30:00Z');
    expect(localDay(now, 'America/Los_Angeles')).toBe('2026-09-03');
  });
});

describe('resolveLocalDay', () => {
  it('uses the cookie zone when valid', () => {
    const now = new Date('2026-09-04T23:30:00Z');
    expect(resolveLocalDay(ctx('Asia/Shanghai'), now)).toBe('2026-09-05');
  });

  it('falls back to UTC when the cookie is missing or bogus', () => {
    const now = new Date('2026-09-04T23:30:00Z');
    expect(resolveLocalDay(ctx(undefined), now)).toBe('2026-09-04');
    expect(resolveLocalDay(ctx('Mars/Olympus'), now)).toBe('2026-09-04');
  });
});

describe('resolveActiveDay', () => {
  it('keeps a session on the day it started when midnight passes', () => {
    // Pinned on the 4th; it is now just past midnight on the 5th.
    const now = new Date('2026-09-05T00:02:00Z');
    expect(resolveActiveDay(ctx('UTC', '2026-09-04'), now)).toBe('2026-09-04');
  });

  it('ignores a pin older than yesterday', () => {
    const now = new Date('2026-09-05T00:02:00Z');
    expect(resolveActiveDay(ctx('UTC', '2026-08-01'), now)).toBe('2026-09-05');
  });

  it('ignores a pin in the future', () => {
    const now = new Date('2026-09-05T00:02:00Z');
    expect(resolveActiveDay(ctx('UTC', '2026-12-25'), now)).toBe('2026-09-05');
  });

  it('ignores a malformed pin', () => {
    const now = new Date('2026-09-05T00:02:00Z');
    expect(resolveActiveDay(ctx('UTC', 'yesterday'), now)).toBe('2026-09-05');
  });

  it('is the local day when nothing is pinned', () => {
    const now = new Date('2026-09-05T00:02:00Z');
    expect(resolveActiveDay(ctx('UTC', undefined), now)).toBe('2026-09-05');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/localDay.test.ts`
Expected: FAIL - cannot resolve `../localDay`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/localDay.ts`:

```ts
// "What day is it for this reader?" A daily practice that rolls over at the
// wrong local hour is worse than no daily practice.

export const TIMEZONE_COOKIE = 'tz';

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

interface CookieContext {
  cookies: { get(name: string): { value: string } | undefined };
}

export function resolveLocalDay(astro: CookieContext, now: Date = new Date()): string {
  const tz = astro.cookies.get(TIMEZONE_COOKIE)?.value;
  return localDay(now, isValidTimeZone(tz) ? tz : 'UTC');
}

/** The day a session is pinned to, set at /today and honoured by the steps. */
export const DAY_COOKIE = 'daily_day';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/localDay.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/localDay.ts src/lib/__tests__/localDay.test.ts
git commit -m "feat: resolve the reader's local calendar day"
```

---

### Task 7: Step definitions

Small, pure, and depended on by both the store and the pages, so it lands before either.

**Files:**
- Create: `src/lib/dailySteps.ts`
- Test: `src/lib/__tests__/dailySteps.test.ts`

**Interfaces:**
- Produces:

```ts
export type Step = 'silencio' | 'lectio' | 'meditatio' | 'oratio' | 'contemplatio' | 'actio';
export const STEP_ORDER: readonly Step[];
export const WRITING_STEPS: readonly Step[];  // meditatio, oratio, actio
export function isStep(v: unknown): v is Step;
export function stepIndex(step: Step): number;
export function nextStep(step: Step): Step | null;
export function progressPercent(reached: Step): number;
export interface StepCopy { name: Record<Lang, string>; prompt: Record<Lang, string>; }
export const STEP_COPY: Record<Step, StepCopy>;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/dailySteps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  STEP_ORDER, WRITING_STEPS, STEP_COPY, isStep, stepIndex, nextStep, progressPercent,
} from '../dailySteps';

describe('step order', () => {
  it('runs the six movements in order', () => {
    expect(STEP_ORDER).toEqual([
      'silencio', 'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
    ]);
  });

  it('takes writing at exactly three steps, and never at contemplatio', () => {
    expect(WRITING_STEPS).toEqual(['meditatio', 'oratio', 'actio']);
    expect(WRITING_STEPS).not.toContain('contemplatio');
  });
});

describe('isStep', () => {
  it('accepts a step and rejects anything else', () => {
    expect(isStep('oratio')).toBe(true);
    expect(isStep('amen')).toBe(false);
    expect(isStep(null)).toBe(false);
  });
});

describe('nextStep', () => {
  it('advances through the list and ends at null', () => {
    expect(nextStep('silencio')).toBe('lectio');
    expect(nextStep('contemplatio')).toBe('actio');
    expect(nextStep('actio')).toBeNull();
  });
});

describe('progressPercent', () => {
  it('starts above zero and ends at one hundred', () => {
    expect(progressPercent('silencio')).toBe(17);
    expect(progressPercent('actio')).toBe(100);
  });
});

describe('STEP_COPY', () => {
  it('has a name and prompt in both languages for every step', () => {
    for (const step of STEP_ORDER) {
      expect(STEP_COPY[step].name.en, step).toBeTruthy();
      expect(STEP_COPY[step].name.zh, step).toBeTruthy();
      expect(STEP_COPY[step].prompt.en, step).toBeTruthy();
      expect(STEP_COPY[step].prompt.zh, step).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dailySteps.test.ts`
Expected: FAIL - cannot resolve `../dailySteps`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dailySteps.ts`:

```ts
// The six movements. Order, progress, and the copy shown at each step.
import type { Lang } from './reading';

export type Step =
  | 'silencio' | 'lectio' | 'meditatio' | 'oratio' | 'contemplatio' | 'actio';

export const STEP_ORDER = [
  'silencio', 'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
] as const satisfies readonly Step[];

/** The steps that take the reader's own words. Contemplatio is deliberately absent. */
export const WRITING_STEPS = ['meditatio', 'oratio', 'actio'] as const satisfies readonly Step[];

export function isStep(v: unknown): v is Step {
  return typeof v === 'string' && (STEP_ORDER as readonly string[]).includes(v);
}

export function stepIndex(step: Step): number {
  return STEP_ORDER.indexOf(step);
}

export function nextStep(step: Step): Step | null {
  const i = stepIndex(step);
  return i === STEP_ORDER.length - 1 ? null : STEP_ORDER[i + 1];
}

export function progressPercent(reached: Step): number {
  return Math.round(((stepIndex(reached) + 1) / STEP_ORDER.length) * 100);
}

export interface StepCopy {
  name: Record<Lang, string>;
  prompt: Record<Lang, string>;
}

export const STEP_COPY: Record<Step, StepCopy> = {
  silencio: {
    name: { en: 'Silencio', zh: '静默' },
    prompt: {
      en: 'Be still. Let the noise settle before you read.',
      zh: '安静下来。在诵读之前，让心中的喧嚣沉淀。',
    },
  },
  lectio: {
    name: { en: 'Lectio', zh: '诵读' },
    prompt: {
      en: 'Read it slowly, twice. There is no hurry.',
      zh: '慢慢地读两遍。不用急。',
    },
  },
  meditatio: {
    name: { en: 'Meditatio', zh: '默想' },
    prompt: {
      en: 'What word or phrase caught you?',
      zh: '哪一个词、哪一句话触动了你？',
    },
  },
  oratio: {
    name: { en: 'Oratio', zh: '祈祷' },
    prompt: {
      en: 'What do you want to say to God about it?',
      zh: '关于这句话，你想对神说什么？',
    },
  },
  contemplatio: {
    name: { en: 'Contemplatio', zh: '默观' },
    prompt: {
      en: 'Nothing more to do now. Rest here a while.',
      zh: '现在无需再做什么。在这里安歇片刻。',
    },
  },
  actio: {
    name: { en: 'Actio', zh: '践行' },
    prompt: {
      en: 'One thing you will do today.',
      zh: '今天你要做的一件事。',
    },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dailySteps.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailySteps.ts src/lib/__tests__/dailySteps.test.ts
git commit -m "feat: define the six daily reading steps"
```

---

### Task 8: Session store

**Files:**
- Create: `src/lib/dailySession.ts`
- Test: `src/lib/__tests__/dailySession.test.ts`

**Interfaces:**
- Consumes: `Step`, `STEP_ORDER`, `stepIndex`, `nextStep` from Task 7.
- Produces:

```ts
export interface DailySessionRow { userId: string; day: string; lang: Lang; reachedStep: Step; completedAt: string | null; }
export interface StepEntry { step: Step; userText: string; aiText: string | null; }
export async function ensureSession(userId: string, day: string, lang: Lang, db?: D1Database): Promise<DailySessionRow>;
export async function getSession(userId: string, day: string, db?: D1Database): Promise<DailySessionRow | null>;
export async function getStepEntries(userId: string, day: string, db?: D1Database): Promise<StepEntry[]>;
export async function saveStepEntry(userId: string, day: string, step: Step, userText: string, aiText: string | null, db?: D1Database): Promise<void>;
export async function advanceTo(userId: string, day: string, step: Step, db?: D1Database): Promise<void>;
export async function completeSession(userId: string, day: string, db?: D1Database): Promise<void>;
export async function listSessions(userId: string, limit?: number, db?: D1Database): Promise<DailySessionRow[]>;
export function canOpenStep(reached: Step, requested: Step): boolean;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/dailySession.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  ensureSession, getSession, saveStepEntry, getStepEntries, advanceTo,
  completeSession, listSessions, canOpenStep,
} from '../dailySession';

let db: any;
beforeEach(() => { db = new D1Memory(); });

describe('canOpenStep', () => {
  it('permits the reached step and anything before it', () => {
    expect(canOpenStep('oratio', 'lectio')).toBe(true);
    expect(canOpenStep('oratio', 'oratio')).toBe(true);
  });

  it('refuses jumping ahead', () => {
    expect(canOpenStep('lectio', 'actio')).toBe(false);
  });
});

describe('ensureSession', () => {
  it('creates a session at silencio', async () => {
    const s = await ensureSession('u1', '2026-09-04', 'en', db);
    expect(s.reachedStep).toBe('silencio');
    expect(s.completedAt).toBeNull();
    expect(s.lang).toBe('en');
  });

  it('is idempotent and does not change the pinned language', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await advanceTo('u1', '2026-09-04', 'oratio', db);
    const again = await ensureSession('u1', '2026-09-04', 'zh', db);
    expect(again.lang).toBe('en');
    expect(again.reachedStep).toBe('oratio');
  });
});

describe('saveStepEntry', () => {
  it('stores the reader text and the model text', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'the bridegroom', 'A gentle reply.', db);
    const entries = await getStepEntries('u1', '2026-09-04', db);
    expect(entries).toEqual([
      { step: 'meditatio', userText: 'the bridegroom', aiText: 'A gentle reply.' },
    ]);
  });

  it('keeps a null model text without failing', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'new wine', null, db);
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.aiText).toBeNull();
    expect(entry.userText).toBe('new wine');
  });

  it('edits rather than duplicates on resubmit', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'first', null, db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'second', 'reply', db);
    const entries = await getStepEntries('u1', '2026-09-04', db);
    expect(entries).toHaveLength(1);
    expect(entries[0].userText).toBe('second');
  });

  it('returns entries in step order regardless of write order', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'actio', 'c', null, db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'a', null, db);
    await saveStepEntry('u1', '2026-09-04', 'oratio', 'b', null, db);
    expect((await getStepEntries('u1', '2026-09-04', db)).map((e) => e.step))
      .toEqual(['meditatio', 'oratio', 'actio']);
  });
});

describe('advanceTo', () => {
  it('never moves the reached step backwards', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await advanceTo('u1', '2026-09-04', 'oratio', db);
    await advanceTo('u1', '2026-09-04', 'lectio', db);
    expect((await getSession('u1', '2026-09-04', db))!.reachedStep).toBe('oratio');
  });
});

describe('completeSession', () => {
  it('stamps completion', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await completeSession('u1', '2026-09-04', db);
    expect((await getSession('u1', '2026-09-04', db))!.completedAt).toBeTruthy();
  });
});

describe('listSessions', () => {
  it('returns a user\'s own days, newest first', async () => {
    await ensureSession('u1', '2026-09-03', 'en', db);
    await ensureSession('u1', '2026-09-04', 'en', db);
    await ensureSession('u2', '2026-09-04', 'en', db);
    const rows = await listSessions('u1', 10, db);
    expect(rows.map((r) => r.day)).toEqual(['2026-09-04', '2026-09-03']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dailySession.test.ts`
Expected: FAIL - cannot resolve `../dailySession`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dailySession.ts`. Read `src/lib/db.ts:1-40` first and copy the `flattenSql` / `ensureTable` idiom exactly, including the module-level `initialized` flag.

```ts
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import type { Lang } from './reading';
import { STEP_ORDER, stepIndex, type Step } from './dailySteps';

const CREATE_SESSIONS_SQL = `CREATE TABLE IF NOT EXISTS daily_sessions (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  lang TEXT NOT NULL,
  reached_step TEXT NOT NULL DEFAULT 'silencio',
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day)
)`;

const CREATE_ENTRIES_SQL = `CREATE TABLE IF NOT EXISTS daily_step_entries (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  step TEXT NOT NULL,
  user_text TEXT NOT NULL,
  ai_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day, step)
)`;

function flattenSql(sql: string): string {
  return sql.split(/\s+/).join(' ').trim();
}

let initialized = false;

async function ensureTables(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(flattenSql(CREATE_SESSIONS_SQL));
  await db.exec(flattenSql(CREATE_ENTRIES_SQL));
  initialized = true;
}

export interface DailySessionRow {
  userId: string;
  day: string;
  lang: Lang;
  reachedStep: Step;
  completedAt: string | null;
}

export interface StepEntry {
  step: Step;
  userText: string;
  aiText: string | null;
}

/** A reader may revisit any step up to the furthest they have reached. */
export function canOpenStep(reached: Step, requested: Step): boolean {
  return stepIndex(requested) <= stepIndex(reached);
}

export async function ensureSession(
  userId: string, day: string, lang: Lang, db: D1Database = env.DB
): Promise<DailySessionRow> {
  await ensureTables(db);
  await db
    .prepare(
      `INSERT INTO daily_sessions (user_id, day, lang) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO NOTHING`
    )
    .bind(userId, day, lang)
    .run();
  const row = await getSession(userId, day, db);
  if (!row) throw new Error(`daily session missing after insert: ${userId} ${day}`);
  return row;
}

export async function getSession(
  userId: string, day: string, db: D1Database = env.DB
): Promise<DailySessionRow | null> {
  await ensureTables(db);
  const row = await db
    .prepare(
      'SELECT lang, reached_step, completed_at FROM daily_sessions WHERE user_id = ? AND day = ?'
    )
    .bind(userId, day)
    .first<{ lang: string; reached_step: string; completed_at: string | null }>();
  if (!row) return null;
  return {
    userId,
    day,
    lang: row.lang as Lang,
    reachedStep: row.reached_step as Step,
    completedAt: row.completed_at,
  };
}

export async function saveStepEntry(
  userId: string, day: string, step: Step, userText: string,
  aiText: string | null, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  await db
    .prepare(
      `INSERT INTO daily_step_entries (user_id, day, step, user_text, ai_text)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day, step) DO UPDATE SET
         user_text = excluded.user_text,
         ai_text = excluded.ai_text`
    )
    .bind(userId, day, step, userText, aiText)
    .run();
}

export async function getStepEntries(
  userId: string, day: string, db: D1Database = env.DB
): Promise<StepEntry[]> {
  await ensureTables(db);
  const { results } = await db
    .prepare('SELECT step, user_text, ai_text FROM daily_step_entries WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .all<{ step: string; user_text: string; ai_text: string | null }>();
  return (results ?? [])
    .map((r) => ({ step: r.step as Step, userText: r.user_text, aiText: r.ai_text }))
    .sort((a, b) => stepIndex(a.step) - stepIndex(b.step));
}

export async function advanceTo(
  userId: string, day: string, step: Step, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  const current = await getSession(userId, day, db);
  if (!current) return;
  if (stepIndex(step) <= stepIndex(current.reachedStep)) return;
  await db
    .prepare('UPDATE daily_sessions SET reached_step = ? WHERE user_id = ? AND day = ?')
    .bind(step, userId, day)
    .run();
}

export async function completeSession(
  userId: string, day: string, db: D1Database = env.DB
): Promise<void> {
  await ensureTables(db);
  await db
    .prepare(
      `UPDATE daily_sessions SET completed_at = CURRENT_TIMESTAMP, reached_step = ?
       WHERE user_id = ? AND day = ?`
    )
    .bind(STEP_ORDER[STEP_ORDER.length - 1], userId, day)
    .run();
}

export async function listSessions(
  userId: string, limit = 60, db: D1Database = env.DB
): Promise<DailySessionRow[]> {
  await ensureTables(db);
  const { results } = await db
    .prepare(
      `SELECT day, lang, reached_step, completed_at FROM daily_sessions
       WHERE user_id = ? ORDER BY day DESC LIMIT ?`
    )
    .bind(userId, limit)
    .all<{ day: string; lang: string; reached_step: string; completed_at: string | null }>();
  return (results ?? []).map((r) => ({
    userId,
    day: r.day,
    lang: r.lang as Lang,
    reachedStep: r.reached_step as Step,
    completedAt: r.completed_at,
  }));
}
```

Note: `initialized` is module-level, so reset it between tests if the D1Memory instance is recreated per test. If the suite fails with "no such table", export a `resetForTests()` that clears the flag and call it in `beforeEach`, following whatever `db.ts`'s tests already do.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dailySession.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailySession.ts src/lib/__tests__/dailySession.test.ts
git commit -m "feat: persist daily reading sessions and step entries"
```

---

### Task 9: Model contract

**Files:**
- Create: `src/lib/dailyReflection.ts`
- Test: `src/lib/__tests__/dailyReflection.test.ts`

**Interfaces:**
- Consumes: `Step` from Task 7.
- Produces:

```ts
export type WritingStep = 'meditatio' | 'oratio' | 'actio';
export interface StepResponseInput {
  step: WritingStep;
  passage: { ref: string; text: string };
  userText: string;
  priorSteps: { step: Step; userText: string }[];
  lang: Lang;
}
export function buildStepMessages(input: StepResponseInput): { role: 'system' | 'user'; content: string }[];
export async function generateStepResponse(input: StepResponseInput): Promise<{ text: string | null }>;
```

`generateStepResponse` returns `{ text: null }` on any failure. It never throws - a failed model call must not cost the reader their words.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/dailyReflection.test.ts`. Mock the OpenAI module the way `src/lib/__tests__/assistant.test.ts` does; read that file first and match its approach.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));

const { buildStepMessages, generateStepResponse } = await import('../dailyReflection');

const input = {
  step: 'oratio' as const,
  passage: { ref: 'Luke 5:33-39', text: 'No one pours new wine into old wineskins.' },
  userText: 'I am afraid of what changing would cost me.',
  priorSteps: [{ step: 'meditatio' as const, userText: 'new wine' }],
  lang: 'en' as const,
};

beforeEach(() => create.mockReset());

describe('buildStepMessages', () => {
  it('carries the passage, the reader\'s words, and prior steps', () => {
    const [system, user] = buildStepMessages(input);
    expect(system.role).toBe('system');
    expect(user.content).toContain('Luke 5:33-39');
    expect(user.content).toContain('I am afraid');
    expect(user.content).toContain('new wine');
  });

  it('instructs oratio never to answer on God\'s behalf', () => {
    const [system] = buildStepMessages(input);
    expect(system.content).toMatch(/on God's behalf/i);
  });

  it('writes in the reader\'s language', () => {
    const [system] = buildStepMessages({ ...input, lang: 'zh' });
    expect(system.content).toContain('Chinese');
  });

  it('varies the instruction by step', () => {
    const med = buildStepMessages({ ...input, step: 'meditatio' })[0].content;
    const act = buildStepMessages({ ...input, step: 'actio' })[0].content;
    expect(med).not.toBe(act);
  });
});

describe('generateStepResponse', () => {
  it('returns the model text', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"text":"A gentle reply."}' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: 'A gentle reply.' });
  });

  it('returns null text when the call throws, and never throws itself', async () => {
    create.mockRejectedValue(new Error('upstream 500'));
    await expect(generateStepResponse(input)).resolves.toEqual({ text: null });
  });

  it('returns null text when the response is truncated', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '{"text":"half' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: null });
  });

  it('returns null text when the payload is not the expected shape', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dailyReflection.test.ts`
Expected: FAIL - cannot resolve `../dailyReflection`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dailyReflection.ts`:

```ts
// The model's part in the daily reading. One short reply per writing step,
// always in response to the reader's own words.
import OpenAI from 'openai';
import type { Lang } from './reading';
import { STEP_COPY, type Step } from './dailySteps';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type WritingStep = 'meditatio' | 'oratio' | 'actio';

export interface StepResponseInput {
  step: WritingStep;
  passage: { ref: string; text: string };
  userText: string;
  priorSteps: { step: Step; userText: string }[];
  lang: Lang;
}

const BASE = (langName: string) =>
  'You are a quiet companion to someone praying Lectio Divina - the ancient practice of slow, ' +
  'prayerful scripture reading. They have just written something of their own. Respond to what ' +
  'they actually wrote. ' +
  'Be warm, hopeful and unhurried. Never predict the future or tell fortunes; this is ' +
  'contemplative reading, not divination. Never quote or cite any scripture other than the ' +
  'passage given. Do not explain what the passage "really means" - they are not asking for a ' +
  'commentary. ' +
  'Stay pastoral rather than clinical: do not diagnose, and if they signal that they are in ' +
  'crisis, respond gently and encourage them to reach for real human help rather than trying to ' +
  'counsel them yourself. ' +
  `Write in ${langName}. ` +
  'Respond ONLY with a single-line, valid JSON object of the form {"text": "..."}.';

const PER_STEP: Record<WritingStep, string> = {
  meditatio:
    ' Reflect back what they noticed, and open it one turn deeper with a single gentle ' +
    'observation or question. Two to three sentences.',
  oratio:
    ' Receive what they have said to God. Do not answer on God\'s behalf and do not speak as God. ' +
    'Affirm what they brought, and at most offer words for something they seemed to be reaching ' +
    'for. Two to three sentences.',
  actio:
    ' Take their intention seriously. If it is vague, help them make it smaller and more ' +
    'concrete. One to two sentences, and never a list of further tasks.',
};

export function buildStepMessages(
  input: StepResponseInput
): { role: 'system' | 'user'; content: string }[] {
  const langName = input.lang === 'zh' ? 'Chinese' : 'English';
  const system = BASE(langName) + PER_STEP[input.step];

  let user = `Passage - ${input.passage.ref}: "${input.passage.text}"\n`;
  for (const prior of input.priorSteps) {
    user += `Earlier, at ${STEP_COPY[prior.step].name.en}, they wrote: "${prior.userText}"\n`;
  }
  user += `Now, at ${STEP_COPY[input.step].name.en}, they write: "${input.userText}"`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export async function generateStepResponse(
  input: StepResponseInput
): Promise<{ text: string | null }> {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano',
      messages: buildStepMessages(input),
      temperature: 0.7,
      max_completion_tokens: 200,
      response_format: { type: 'json_object' },
    });
    const choice = response.choices[0];
    if (choice.finish_reason === 'length') return { text: null };
    const data = JSON.parse(choice.message.content ?? '{}');
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    return { text: text || null };
  } catch (e) {
    // The reader's words are saved by the caller regardless. Losing the
    // model's comment is acceptable; losing a prayer is not.
    console.error('daily step reflection failed:', e);
    return { text: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dailyReflection.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailyReflection.ts src/lib/__tests__/dailyReflection.test.ts
git commit -m "feat: per-step model responses for the daily reading"
```

---

### Task 10: Entry point and progress component

The `/today` route and the shared progress rail. No step screens yet - this task ends with `/today` redirecting correctly.

**Files:**
- Create: `src/pages/today/index.astro`
- Create: `src/components/DailyProgress.astro`

**Interfaces:**
- Consumes: `resolveLocalDay` (Task 6), `getLectionaryDay` (Task 4), `ensureSession`, `getSession` (Task 8), `progressPercent`, `STEP_ORDER`, `STEP_COPY` (Task 7), plus existing `resolveLang` and `verifySessionToken`.
- Produces: `DailyProgress.astro` taking props `{ reached: Step; current: Step; lang: Lang; day: string }`.

- [ ] **Step 1: Write the entry page**

Create `src/pages/today/index.astro`. Follow the header of `src/pages/index.astro:1-30` for how a page resolves language and the signed-in user.

```astro
---
export const prerender = false;

import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../../lib/session';
import { resolveLang } from '../../lib/i18n';
import { resolveLocalDay, DAY_COOKIE } from '../../lib/localDay';
import { ensureSession, getSession } from '../../lib/dailySession';

const lang = resolveLang(Astro);
const day = resolveLocalDay(Astro);

// Pin the day for the rest of this sitting, so crossing midnight mid-session
// does not split a reader's words across two days. Six hours is longer than
// any session and short enough that tomorrow starts fresh.
Astro.cookies.set(DAY_COOKIE, day, {
  path: '/', httpOnly: true, sameSite: 'lax', maxAge: 6 * 60 * 60,
});

const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

// Anonymous readers start at the beginning; they are gated later, at meditatio.
if (!userId) return Astro.redirect('/today/silencio');

const existing = await getSession(userId, day);
if (!existing) await ensureSession(userId, day, lang);
const reached = existing?.reachedStep ?? 'silencio';

// A finished day goes to its summary rather than back to the first step.
if (existing?.completedAt) return Astro.redirect('/today/amen');
return Astro.redirect(`/today/${reached}`);
---
```

- [ ] **Step 2: Write the progress component**

Create `src/components/DailyProgress.astro`. Match the styling idiom of the existing components - read `src/components/AssistantWidget.astro` for how scoped styles are written in this repo.

```astro
---
import { STEP_ORDER, STEP_COPY, stepIndex, progressPercent, type Step } from '../lib/dailySteps';
import type { Lang } from '../lib/reading';

interface Props { reached: Step; current: Step; lang: Lang; day: string }
const { reached, current, lang } = Astro.props;
const percent = progressPercent(reached);
---

<nav class="daily-progress" aria-label="Lectio Divina steps">
  <ol>
    {STEP_ORDER.map((step) => (
      <li
        class:list={[
          { done: stepIndex(step) < stepIndex(reached) },
          { current: step === current },
          { locked: stepIndex(step) > stepIndex(reached) },
        ]}
      >
        {stepIndex(step) <= stepIndex(reached) ? (
          <a href={`/today/${step}`}>{STEP_COPY[step].name[lang]}</a>
        ) : (
          <span>{STEP_COPY[step].name[lang]}</span>
        )}
      </li>
    ))}
  </ol>
  <div class="bar" role="progressbar" aria-valuenow={percent} aria-valuemin="0" aria-valuemax="100">
    <div class="fill" style={`width: ${percent}%`}></div>
  </div>
</nav>
```

Add scoped styles: a horizontal rail on wide screens, wrapping on narrow ones, with `locked` steps muted and non-interactive.

- [ ] **Step 3: Set the timezone cookie**

The local day depends on a `tz` cookie that only the client can set. Add this to the site layout (`src/layouts/Layout.astro`) so it is set on any page visit, not only on `/today`:

```html
<script is:inline>
  (function () {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && document.cookie.indexOf('tz=') === -1) {
        document.cookie = 'tz=' + encodeURIComponent(tz) + ';path=/;max-age=31536000;samesite=lax';
      }
    } catch (e) {}
  })();
</script>
```

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`

Check: signed out, `/today` lands on `/today/silencio` (which 404s for now - expected, the step page arrives in Task 11). Signed in, it also lands on `/today/silencio` and a row appears in `daily_sessions`. Confirm the `tz` cookie is set in devtools.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/pages/today/index.astro src/components/DailyProgress.astro src/layouts/Layout.astro
git commit -m "feat: daily reading entry point and step progress rail"
```

---

### Task 11: The silent steps

Silencio, Lectio and Contemplatio: no input, no model call. Building these first means the route, guard and layout are proven before any writing or model work lands on top.

**Files:**
- Create: `src/pages/today/[step].astro`

**Interfaces:**
- Consumes: everything from Tasks 4, 6, 7, 8, 10, plus `resolvePassage` from Task 5.
- Produces: the `/today/[step]` route, which Task 12 extends with the writing steps.

- [ ] **Step 1: Write the step page for the silent steps**

Create `src/pages/today/[step].astro`:

```astro
---
export const prerender = false;

import Layout from '../../layouts/Layout.astro';
import DailyProgress from '../../components/DailyProgress.astro';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../../lib/session';
import { resolveLang } from '../../lib/i18n';
import { resolveActiveDay } from '../../lib/localDay';
import { getLectionaryDay, focusReference } from '../../lib/lectionary';
import { resolvePassage } from '../../lib/passage';
import { isStep, nextStep, STEP_COPY, type Step } from '../../lib/dailySteps';
import {
  ensureSession, getSession, advanceTo, canOpenStep, getStepEntries,
} from '../../lib/dailySession';

const stepParam = Astro.params.step;
if (!isStep(stepParam)) return Astro.redirect('/today');
const step: Step = stepParam;

const lang = resolveLang(Astro);
const day = resolveActiveDay(Astro);
const entry = getLectionaryDay(day);
const passage = resolvePassage(focusReference(entry), lang);

const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

// Anonymous readers may take the first two steps; meditatio asks them to sign in.
const ANON_STEPS: Step[] = ['silencio', 'lectio'];
if (!userId && !ANON_STEPS.includes(step)) {
  return Astro.redirect(`/login?return=${encodeURIComponent(`/today/${step}`)}`);
}

let reached: Step = 'silencio';
if (userId) {
  const session = (await getSession(userId, day)) ?? (await ensureSession(userId, day, lang));
  reached = session.reachedStep;
  // No jumping ahead: a reader cannot land on oratio without having read.
  if (!canOpenStep(reached, step)) return Astro.redirect(`/today/${reached}`);
}

const entries = userId ? await getStepEntries(userId, day) : [];
const priorText = (s: Step) => entries.find((e) => e.step === s)?.userText ?? '';

// Advancing past a silent step needs no submission, so record arrival now.
if (userId) await advanceTo(userId, day, step);

const copy = STEP_COPY[step];
const next = nextStep(step);
---

<Layout title={`${copy.name[lang]} · ${entry.title[lang]}`}>
  <article class="daily">
    <header>
      <p class="day">{entry.title[lang]}</p>
      <h1>{copy.name[lang]}</h1>
      <p class="prompt">{copy.prompt[lang]}</p>
    </header>

    <DailyProgress reached={reached} current={step} lang={lang} day={day} />

    {step === 'silencio' && (
      <section class="silence">
        <div class="timer" data-seconds="60" aria-live="polite"></div>
        <a class="advance" href={`/today/${next}`}>{lang === 'zh' ? '开始' : 'Begin'}</a>
      </section>
    )}

    {step === 'lectio' && (
      <section class="reading" data-font-scale="1">
        <div class="controls" aria-label={lang === 'zh' ? '字体大小' : 'Text size'}>
          <button type="button" data-scale="-1">A-</button>
          <button type="button" data-scale="0">A</button>
          <button type="button" data-scale="1">A+</button>
        </div>
        {passage ? (
          <>
            <p class="ref">{passage.ref}</p>
            <p class="text">{passage.text}</p>
            <p class="twice">{lang === 'zh' ? '请读第二遍。' : 'Now read it a second time.'}</p>
          </>
        ) : (
          <p class="text">{lang === 'zh' ? '今天的经文暂时无法显示。' : "Today's passage could not be loaded."}</p>
        )}
        <a class="advance" href={`/today/${next}`}>{lang === 'zh' ? '继续' : 'Continue'}</a>
      </section>
    )}

    {step === 'contemplatio' && (
      <section class="rest">
        {priorText('oratio') && <blockquote class="own-words">{priorText('oratio')}</blockquote>}
        <div class="timer" data-seconds="120" aria-live="polite"></div>
        <a class="advance" href={`/today/${next}`}>{lang === 'zh' ? '继续' : 'Continue'}</a>
      </section>
    )}
  </article>
</Layout>

<script>
  // Count down, then reveal the advance link. Skippable: the link is never
  // disabled, only de-emphasised until the timer finishes.
  document.querySelectorAll<HTMLElement>('.timer').forEach((el) => {
    let left = Number(el.dataset.seconds ?? 60);
    const render = () => { el.textContent = String(left); };
    render();
    const id = setInterval(() => {
      left -= 1;
      render();
      if (left <= 0) {
        clearInterval(id);
        el.closest('section')?.classList.add('ready');
      }
    }, 1000);
  });

  const reading = document.querySelector<HTMLElement>('.reading');
  reading?.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = Number(btn.dataset.scale);
      const current = Number(reading.dataset.fontScale ?? 1);
      const next = step === 0 ? 1 : Math.min(1.6, Math.max(0.85, current + step * 0.15));
      reading.dataset.fontScale = String(next);
      reading.style.setProperty('--reading-scale', String(next));
    });
  });
</script>
```

Add scoped styles: generous line height on `.text`, `--reading-scale` driving its `font-size`, and `.advance` muted until the parent section has `.ready`.

Note the `/login?return=` shape - check `src/pages/login.astro` and `src/lib/authReturn.ts` for the parameter name this repo actually uses, and match it.

- [ ] **Step 2: Verify by hand**

Run: `npm run dev`

Check, signed in: `/today` goes to `/today/silencio`; the timer counts down and Begin leads to `/today/lectio`; the passage renders and A+ enlarges it; `/today/actio` typed directly redirects back to the furthest reached step. Signed out: `/today/meditatio` redirects to login.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/today/\[step\].astro
git commit -m "feat: silent steps of the daily reading"
```

---

### Task 12: The writing steps

Meditatio, Oratio and Actio: textarea, POST, model reply, advance.

**Files:**
- Modify: `src/pages/today/[step].astro`
- Test: `src/lib/__tests__/dailyStepSubmit.test.ts`

**Interfaces:**
- Consumes: `generateStepResponse` (Task 9), `saveStepEntry`, `advanceTo`, `completeSession` (Task 8).
- Produces: `handleStepSubmit`, extracted into `src/lib/dailySubmit.ts` so the save-before-model ordering is testable without rendering a page.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/dailyStepSubmit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const generateStepResponse = vi.fn();
vi.mock('../dailyReflection', () => ({ generateStepResponse }));

const { handleStepSubmit } = await import('../dailySubmit');
const { ensureSession, getStepEntries, getSession } = await import('../dailySession');

let db: any;
const base = () => ({
  userId: 'u1',
  day: '2026-09-04',
  step: 'meditatio' as const,
  userText: 'new wine',
  passage: { ref: 'Luke 5:33-39', text: 'New wine into fresh wineskins.' },
  lang: 'en' as const,
  db,
});

beforeEach(async () => {
  db = new D1Memory();
  generateStepResponse.mockReset();
  await ensureSession('u1', '2026-09-04', 'en', db);
});

describe('handleStepSubmit', () => {
  it('saves the text and the model reply, then advances', async () => {
    generateStepResponse.mockResolvedValue({ text: 'A gentle reply.' });
    const result = await handleStepSubmit(base());
    expect(result.next).toBe('oratio');
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.userText).toBe('new wine');
    expect(entry.aiText).toBe('A gentle reply.');
    expect((await getSession('u1', '2026-09-04', db))!.reachedStep).toBe('oratio');
  });

  it('still saves and still advances when the model fails', async () => {
    generateStepResponse.mockResolvedValue({ text: null });
    const result = await handleStepSubmit(base());
    expect(result.next).toBe('oratio');
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.userText).toBe('new wine');
    expect(entry.aiText).toBeNull();
  });

  it('rejects empty writing without calling the model', async () => {
    const result = await handleStepSubmit({ ...base(), userText: '   ' });
    expect(result.error).toBe('empty');
    expect(generateStepResponse).not.toHaveBeenCalled();
    expect(await getStepEntries('u1', '2026-09-04', db)).toEqual([]);
  });

  it('passes prior steps to the model for continuity', async () => {
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit(base());
    generateStepResponse.mockClear();
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit({ ...base(), step: 'oratio', userText: 'I am afraid.' });
    expect(generateStepResponse.mock.calls[0][0].priorSteps).toEqual([
      { step: 'meditatio', userText: 'new wine' },
    ]);
  });

  it('skips the model on an unchanged resubmit', async () => {
    generateStepResponse.mockResolvedValue({ text: 'A gentle reply.' });
    await handleStepSubmit(base());
    generateStepResponse.mockClear();
    await handleStepSubmit(base());
    expect(generateStepResponse).not.toHaveBeenCalled();
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.aiText).toBe('A gentle reply.');
  });

  it('completes the session at actio', async () => {
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit({ ...base(), step: 'actio', userText: 'Call my brother.' });
    const session = await getSession('u1', '2026-09-04', db);
    expect(session!.completedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dailyStepSubmit.test.ts`
Expected: FAIL - cannot resolve `../dailySubmit`.

- [ ] **Step 3: Write the submit handler**

Create `src/lib/dailySubmit.ts`:

```ts
import type { D1Database } from '@cloudflare/workers-types';
import type { Lang } from './reading';
import { nextStep, type Step } from './dailySteps';
import { generateStepResponse, type WritingStep } from './dailyReflection';
import {
  getStepEntries, saveStepEntry, advanceTo, completeSession,
} from './dailySession';

export interface StepSubmitInput {
  userId: string;
  day: string;
  step: WritingStep;
  userText: string;
  passage: { ref: string; text: string };
  lang: Lang;
  db?: D1Database;
}

export interface StepSubmitResult {
  next: Step | null;
  aiText: string | null;
  error?: 'empty';
}

export const STEP_TEXT_MAX_CHARS = 2000;

export async function handleStepSubmit(input: StepSubmitInput): Promise<StepSubmitResult> {
  const userText = input.userText.trim().slice(0, STEP_TEXT_MAX_CHARS);
  if (!userText) return { next: null, aiText: null, error: 'empty' };

  const entries = await getStepEntries(input.userId, input.day, input.db);
  const existing = entries.find((e) => e.step === input.step);

  // An unchanged resubmit (double tap, refresh) must not spend another call.
  if (existing && existing.userText === userText && existing.aiText) {
    return { next: nextStep(input.step), aiText: existing.aiText };
  }

  const priorSteps = entries
    .filter((e) => e.step !== input.step)
    .map((e) => ({ step: e.step, userText: e.userText }));

  const { text } = await generateStepResponse({
    step: input.step,
    passage: input.passage,
    userText,
    priorSteps,
    lang: input.lang,
  });

  // Save first and unconditionally: the reader's words survive a model outage.
  await saveStepEntry(input.userId, input.day, input.step, userText, text, input.db);

  const next = nextStep(input.step);
  if (next) await advanceTo(input.userId, input.day, next, input.db);
  else await completeSession(input.userId, input.day, input.db);

  return { next, aiText: text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dailyStepSubmit.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the writing steps into the page**

In `src/pages/today/[step].astro`, add a POST branch in the frontmatter, above the render, following the `Astro.request.method === 'POST'` idiom at `src/pages/index.astro:169`:

```ts
import { handleStepSubmit, STEP_TEXT_MAX_CHARS } from '../../lib/dailySubmit';
import { WRITING_STEPS } from '../../lib/dailySteps';

let submitError: 'empty' | null = null;

if (Astro.request.method === 'POST' && userId && passage) {
  const form = await Astro.request.formData();
  const userText = String(form.get('step_text') ?? '');
  const result = await handleStepSubmit({
    userId, day, step: step as (typeof WRITING_STEPS)[number], userText, passage, lang,
  });
  if (result.error === 'empty') submitError = 'empty';
  // Redirect after POST so a refresh never resubmits.
  else return Astro.redirect(`/today/${step}?saved=1`);
}

const saved = Astro.url.searchParams.get('saved') === '1';
const myEntry = entries.find((e) => e.step === step) ?? null;
```

and add the writing-step markup alongside the silent ones:

```astro
{WRITING_STEPS.includes(step as any) && (
  <section class="writing">
    {step !== 'meditatio' && priorText('meditatio') && (
      <blockquote class="own-words">{priorText('meditatio')}</blockquote>
    )}
    {passage && step === 'meditatio' && (
      <p class="text">{passage.text}</p>
    )}

    {saved && myEntry ? (
      <>
        <blockquote class="own-words mine">{myEntry.userText}</blockquote>
        {myEntry.aiText
          ? <p class="reply">{myEntry.aiText}</p>
          : <p class="reply muted">{copy.prompt[lang]}</p>}
        <a class="advance" href={next ? `/today/${next}` : '/today/amen'}>
          {lang === 'zh' ? '继续' : 'Continue'}
        </a>
      </>
    ) : (
      <form method="post">
        <label for="step_text">{copy.prompt[lang]}</label>
        {/* A textarea's value is its children, never a value attribute. */}
        <textarea id="step_text" name="step_text" rows="5"
          maxlength={STEP_TEXT_MAX_CHARS} required>{myEntry?.userText ?? ''}</textarea>
        {submitError === 'empty' && (
          <p class="error">{lang === 'zh' ? '请先写下一点什么。' : 'Write something first.'}</p>
        )}
        <button type="submit">{lang === 'zh' ? '继续' : 'Continue'}</button>
      </form>
    )}
  </section>
)}
```

Note the null-model case renders the step's own prompt rather than an error - a reader whose model call failed should not be told the machine broke.

Guard the `advanceTo(userId, day, step)` call added in Task 11 so it only fires for silent steps; a writing step advances on submit, not on arrival.

- [ ] **Step 6: Verify by hand**

Run: `npm run dev`

Walk the whole flow signed in: silencio through actio, writing at each of the three. Check that refreshing after a submit does not resubmit, that going back to `/today/meditatio` shows your earlier words, and that the passage is still on screen at meditatio.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dailySubmit.ts src/lib/__tests__/dailyStepSubmit.test.ts src/pages/today/\[step\].astro
git commit -m "feat: writing steps with model responses"
```

---

### Task 13: Closing summary and history

**Files:**
- Create: `src/pages/today/amen.astro`
- Modify: `src/pages/history/index.astro`
- Modify: `README.md`

**Interfaces:**
- Consumes: `listSessions`, `getStepEntries`, `getSession` (Task 8); `getLectionaryDay`, `focusReference` (Task 4); `resolvePassage` (Task 5).

- [ ] **Step 1: Write the summary page**

Create `src/pages/today/amen.astro`. It serves both the just-finished session and any past day via `?day=YYYY-MM-DD`.

```astro
---
export const prerender = false;

import Layout from '../../layouts/Layout.astro';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../../lib/session';
import { resolveLang } from '../../lib/i18n';
import { resolveActiveDay } from '../../lib/localDay';
import { getLectionaryDay, focusReference } from '../../lib/lectionary';
import { resolvePassage } from '../../lib/passage';
import { STEP_COPY } from '../../lib/dailySteps';
import { getSession, getStepEntries } from '../../lib/dailySession';

const lang = resolveLang(Astro);
const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
if (!userId) return Astro.redirect('/login?return=%2Ftoday');

const requested = Astro.url.searchParams.get('day');
const day = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') ? requested! : resolveActiveDay(Astro);

const session = await getSession(userId, day);
if (!session) return Astro.redirect('/today');

const entry = getLectionaryDay(day);
const passage = resolvePassage(focusReference(entry), session.lang);
const entries = await getStepEntries(userId, day);
---

<Layout title={`${entry.title[lang]} · Amen`}>
  <article class="amen">
    <p class="day">{entry.title[lang]}</p>
    {passage && <p class="ref">{passage.ref}</p>}
    {passage && <p class="text">{passage.text}</p>}

    {entries.map((e) => (
      <section>
        <h2>{STEP_COPY[e.step].name[lang]}</h2>
        <blockquote class="own-words mine">{e.userText}</blockquote>
        {e.aiText && <p class="reply">{e.aiText}</p>}
      </section>
    ))}

    <a href="/history">{lang === 'zh' ? '查看过往' : 'See past days'}</a>
  </article>
</Layout>
```

The date regex matters: `day` goes into a query, and an unvalidated path parameter is not something to hand to the database.

- [ ] **Step 2: Add daily sessions to history**

Read `src/pages/history/index.astro` and follow its existing list markup. Add a section listing `listSessions(userId)`, each row showing the liturgical title, the date, whether it was completed, and linking to `/today/amen?day=<day>`. Do not restructure the existing draw list.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`

Complete a session, confirm you land on `/today/amen` with all three of your entries. Visit `/history`, confirm the day is listed and links back to a readable summary. Confirm `/today/amen?day=1999-01-01` redirects rather than erroring.

- [ ] **Step 4: Update the README**

Add to the project structure section:

```
- `src/lib/liturgicalCalendar.ts` — Easter, Advent, and liturgical year math
- `src/lib/lectionary.ts` — the daily reading table (generated into `lectionaryDays.json`)
- `src/lib/dailySession.ts` — `daily_sessions` and `daily_step_entries` tables
- `src/lib/dailyReflection.ts` — per-step model responses for the daily reading
- `scripts/build-lectionary.mjs` — regenerates `lectionaryDays.json`; runs in `prebuild`
```

and note in the bindings section that `DB` now also holds `daily_sessions` and `daily_step_entries`, self-creating on first use.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/today/amen.astro src/pages/history/index.astro README.md
git commit -m "feat: daily reading summary and history"
```

---

### Task 14: Entry points and final verification

Nothing links to `/today` yet.

**Files:**
- Modify: `src/layouts/Layout.astro` (navigation)
- Modify: `src/pages/index.astro` (a link only - no behaviour change)

- [ ] **Step 1: Add navigation**

Add a "Today" / "今日" link to the site navigation in `src/layouts/Layout.astro`, following the existing nav markup.

- [ ] **Step 2: Add a homepage entry point**

Add a link to `/today` on the homepage, near the spread picker. Do not change any existing draw behaviour, form, or entitlement call.

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: PASS, whole suite.

Run: `npx astro check`
Expected: no new type errors.

Run: `npm run build`
Expected: the build succeeds and `prebuild` regenerates the lectionary without the coverage guard firing.

- [ ] **Step 4: Walk the whole flow once more**

Run: `npm run dev`

Signed out: homepage draw still works exactly as before; `/today` reaches silencio and lectio, then asks for sign-in at meditatio and returns to meditatio after login. Signed in: a full six-step session in both languages, then `/today` a second time resumes at the summary rather than restarting.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Layout.astro src/pages/index.astro
git commit -m "feat: link the daily reading from navigation and homepage"
```

---

## Notes for the executor

- **Task 5 Step 4 is a real decision point.** Measure the file, then take the branch the measurement indicates. Do not carry on with a bundled 10 MB JSON because the plan's happy path assumed it would be small.
- **Task 2 requires a licensing judgement** that the plan cannot make for you. If the terms of your source are unclear, stop and ask rather than committing the file.
- The `zh` liturgical titles in `rcl-source.json` are authored by hand. If your Chinese is not good enough to write them well, flag it rather than machine-translating a liturgical calendar.
- Contemplatio has no model call and no textarea. If you find yourself adding either, re-read the spec.
