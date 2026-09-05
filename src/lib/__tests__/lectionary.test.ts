import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLectionaryDay, focusReference, windowRemainingDays } from '../lectionary';

afterEach(() => { vi.restoreAllMocks(); });

describe('getLectionaryDay', () => {
  it('returns the generated entry for a date in the window', () => {
    const day = getLectionaryDay('2026-09-04');
    expect(day.title.en).toBeTruthy();
    expect(day.title.zh).toBeTruthy();
    expect(day.readings.gospel).toBeTruthy();
    expect([1, 2]).toContain(day.officeYear);
  });

  it('falls back rather than throwing for a date outside the window', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const day = getLectionaryDay('1999-01-01');
    expect(day.readings[day.focus]).toBeTruthy();
    expect(day.title.en).toBeTruthy();
    expect(day.title.zh).toBeTruthy();
    expect(logged).toHaveBeenCalled();
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
