import { describe, it, expect } from 'vitest';
import {
  easterSunday, adventFirstSunday, liturgicalYear, sundayOnOrBefore, addDays, officeYear,
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
    expect(liturgicalYear('2026-11-28')).toEqual({ endingYear: 2026, cycle: 'A' });
    // Advent 2026 starts the year ending in 2027.
    expect(liturgicalYear('2026-11-29')).toEqual({ endingYear: 2027, cycle: 'B' });
    // January stays in the year that began the previous Advent.
    expect(liturgicalYear('2027-01-10')).toEqual({ endingYear: 2027, cycle: 'B' });
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

describe('officeYear', () => {
  it('runs Year One into odd civil years and Year Two into even ones', () => {
    // Advent 2026 begins the year running through 2027, which is odd: Year One.
    expect(officeYear('2026-11-29')).toBe(1);
    expect(officeYear('2027-06-01')).toBe(1);
    // Advent 2027 begins the year running through 2028: Year Two.
    expect(officeYear('2027-11-28')).toBe(2);
    expect(officeYear('2028-06-01')).toBe(2);
  });

  it('changes at Advent, not at New Year', () => {
    expect(officeYear('2026-11-28')).toBe(2);
    expect(officeYear('2026-11-29')).toBe(1);
  });
});
