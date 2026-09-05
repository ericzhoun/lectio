import { describe, it, expect } from 'vitest';
// The generator is plain JS, so its return type is asserted here rather than
// inferred. `lectionary.ts` is the module that owns this shape.
import { buildDays } from '../../../scripts/build-lectionary.mjs';
import type { LectionaryDay } from '../lectionary';

const days = buildDays(2026, 2030) as Record<string, LectionaryDay>;

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

  it('gives each weekday its own readings', () => {
    // A true daily lectionary: consecutive days differ.
    expect(days['2026-09-04'].readings.gospel)
      .not.toBe(days['2026-09-03'].readings.gospel);
  });

  it('places Easter and Advent correctly', () => {
    expect(days['2026-04-05'].season).toBe('easter');
    expect(days['2026-11-29'].season).toBe('advent');
    expect(days['2026-11-29'].week).toBe('Week of 1 Advent');
  });

  it('alternates the office year at Advent', () => {
    expect(days['2026-11-28'].officeYear).toBe(2);
    expect(days['2026-11-29'].officeYear).toBe(1);
  });

  it('places a Proper on the Sunday closest to its date', () => {
    // Proper 17 is the week of the Sunday closest to August 31.
    // In 2026 that Sunday is August 30.
    expect(days['2026-08-30'].week).toBe('Week of Proper 17');
    expect(days['2026-09-04'].week).toBe('Week of Proper 17');
  });

  it('uses the named readings for a holy day', () => {
    // Easter Day 2026 takes the Easter Day readings, not Easter Week Sunday.
    expect(days['2026-04-05'].week).toBe('Easter Day');
  });

  it('gives every day its own readings, carrying none forward', () => {
    // Earned the hard way: the seasonal tables omit Dec 26-28 (St Stephen,
    // St John, Holy Innocents) and print the gospel of a principal feast in
    // the evening column. Both are filled, so no day repeats its predecessor.
    const keys = Object.keys(days);
    const carried = keys.filter(
      (k, i) => i > 0 && days[k].readings.gospel === days[keys[i - 1]].readings.gospel
    );
    expect(carried).toEqual([]);
  });

  it('reads the evening gospel of a principal feast', () => {
    // Palm Sunday prints no morning gospel; its gospel is Luke 19:41-48.
    expect(days['2026-03-29'].week).toBe('Palm Sunday');
    expect(days['2026-03-29'].readings.gospel).toBe('Luke 19:41-48');
  });

  it('fills the Christmas-week holy days the seasonal tables omit', () => {
    expect(days['2026-12-28'].week).toBe('Holy Innocents');
    expect(days['2026-12-28'].readings.gospel).toBe('Matthew 18:1-14');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildDays(2026, 2030))).toBe(JSON.stringify(days));
  });
});
