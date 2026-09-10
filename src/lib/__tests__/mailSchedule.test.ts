import { describe, expect, it } from 'vitest';
import { dueNow, localDayAndHour, DEFAULT_TIMEZONE } from '../mailSchedule';
import type { Subscriber } from '../mailSchedule';

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    email: 'reader@example.test',
    lang: 'en',
    tz: 'America/Los_Angeles',
    lastSent: null,
    ...overrides,
  };
}

describe('localDayAndHour', () => {
  it('reads the wall clock in the given zone, not UTC', () => {
    // 2026-03-10T14:00Z is 06:00 in Los Angeles (PDT, UTC-8 on that date is
    // PST; March 10 2026 is after the second Sunday, so PDT, UTC-7).
    expect(localDayAndHour(new Date('2026-03-10T13:00:00Z'), 'America/Los_Angeles'))
      .toEqual({ day: '2026-03-10', hour: 6 });
  });

  it('reports hour 0 rather than 24 at local midnight', () => {
    expect(localDayAndHour(new Date('2026-03-10T07:00:00Z'), 'America/Los_Angeles').hour).toBe(0);
  });

  it('falls back to the default zone when the stored zone is nonsense', () => {
    const bogus = localDayAndHour(new Date('2026-03-10T13:00:00Z'), 'Mars/Olympus');
    const fallback = localDayAndHour(new Date('2026-03-10T13:00:00Z'), DEFAULT_TIMEZONE);
    expect(bogus).toEqual(fallback);
  });
});

describe('dueNow', () => {
  it('sends at 06:00 local and not before or after the retry window', () => {
    const at5 = new Date('2026-03-10T12:00:00Z');
    const at6 = new Date('2026-03-10T13:00:00Z');
    const at10 = new Date('2026-03-10T17:00:00Z');
    expect(dueNow(at5, [sub()])).toHaveLength(0);
    expect(dueNow(at6, [sub()])).toHaveLength(1);
    expect(dueNow(at10, [sub()])).toHaveLength(0);
  });

  it('is due at 6, 7, 8 and 9 local but not at 5 or 10', () => {
    const hours = [5, 6, 7, 8, 9, 10];
    const results = hours.map((h) =>
      dueNow(new Date(`2026-03-10T${String(13 + (h - 6)).padStart(2, '0')}:00:00Z`), [sub()])
        .length
    );
    expect(results).toEqual([0, 1, 1, 1, 1, 0]);
  });

  it('a subscriber already sent today is not due at 7 even though the window is open', () => {
    const at7 = new Date('2026-03-10T14:00:00Z');
    expect(dueNow(at7, [sub({ lastSent: '2026-03-10' })])).toHaveLength(0);
  });

  it('picks each zone at its own 06:00 from one hourly tick', () => {
    // 22:00Z is 06:00 the next day in Shanghai and 14:00 in Los Angeles.
    const tick = new Date('2026-03-10T22:00:00Z');
    const due = dueNow(tick, [
      sub({ email: 'la@example.test', tz: 'America/Los_Angeles' }),
      sub({ email: 'sh@example.test', tz: 'Asia/Shanghai', lang: 'zh' }),
    ]);
    expect(due.map((s) => s.email)).toEqual(['sh@example.test']);
    expect(due[0].localDay).toBe('2026-03-11');
  });

  it('does not send twice in one local day', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    expect(dueNow(at6, [sub({ lastSent: '2026-03-10' })])).toHaveLength(0);
  });

  it('sends again the following local day', () => {
    const nextDay = new Date('2026-03-11T13:00:00Z');
    expect(dueNow(nextDay, [sub({ lastSent: '2026-03-10' })])).toHaveLength(1);
  });

  it('still sends exactly once on the spring-forward day', () => {
    // US DST begins 2026-03-08. 06:00 local is 13:00Z after the shift.
    const before = new Date('2026-03-08T12:00:00Z'); // 05:00 local
    const at6 = new Date('2026-03-08T13:00:00Z'); // 06:00 local
    expect(dueNow(before, [sub()])).toHaveLength(0);
    expect(dueNow(at6, [sub()])).toHaveLength(1);
  });

  it('still sends exactly once on the fall-back day', () => {
    // US DST ends 2026-11-01. 06:00 local is 14:00Z after the shift.
    const at6 = new Date('2026-11-01T14:00:00Z');
    const due = dueNow(at6, [sub()]);
    expect(due).toHaveLength(1);
    // The repeated 01:00 hour must not produce a second send later that day.
    expect(dueNow(new Date('2026-11-01T15:00:00Z'), [sub({ lastSent: due[0].localDay })]))
      .toHaveLength(0);
  });

  it('treats a subscriber with an unusable zone as Pacific rather than dropping them', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    expect(dueNow(at6, [sub({ tz: '' })])).toHaveLength(1);
  });

  it('treats a malformed lastSent as never sent, so a corrupt row fails open rather than going silent forever', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    expect(dueNow(at6, [sub({ lastSent: 'unknown' })])).toHaveLength(1);
    expect(dueNow(at6, [sub({ lastSent: '' })])).toHaveLength(1);
  });
});
