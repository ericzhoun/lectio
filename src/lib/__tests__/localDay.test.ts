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
