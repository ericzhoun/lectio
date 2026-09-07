import { describe, it, expect } from 'vitest';
import { parseEventRows, computeJourneySummary, type RawEventRow } from '../journey';

// D1 stores ts as UTC 'YYYY-MM-DD HH:MM:SS'.
const NOW = new Date('2026-09-06T12:00:00Z');
const SEVEN_DAYS = 7;

const ev = (overrides: Partial<RawEventRow> & { name: string; visitor_id: string; ts: string }): RawEventRow => ({
  user_id: null,
  path: null,
  lang: null,
  variants: null,
  props: null,
  ...overrides,
});

const run = (rows: RawEventRow[], days = SEVEN_DAYS, firstSeen?: Map<string, string>) =>
  computeJourneySummary(parseEventRows(rows), { days, now: NOW, firstSeen });

describe('parseEventRows', () => {
  it('maps snake_case D1 columns and parses JSON columns', () => {
    const rows = parseEventRows([
      {
        name: 'cta_click',
        visitor_id: 'v1',
        user_id: 'u1',
        path: '/today',
        lang: 'en',
        variants: '{"signup_cta_copy":"invitation"}',
        props: '{"slot":"nav_today"}',
        ts: '2026-09-01 10:00:00',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: 'cta_click',
      visitorId: 'v1',
      userId: 'u1',
      path: '/today',
      lang: 'en',
      variants: { signup_cta_copy: 'invitation' },
      props: { slot: 'nav_today' },
      ts: '2026-09-01 10:00:00',
    });
  });

  it('drops rows missing a name, visitor id, or timestamp', () => {
    const rows = parseEventRows([
      { name: '', visitor_id: 'v1', ts: '2026-09-01 10:00:00' },
      { name: 'page_view', visitor_id: '', ts: '2026-09-01 10:00:00' },
      { name: 'page_view', visitor_id: 'v1', ts: null },
      { name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitorId).toBe('v1');
  });

  it('survives invalid JSON in variants/props', () => {
    const rows = parseEventRows([
      { name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00', variants: '{oops', props: 'nope' },
    ]);
    expect(rows[0].variants).toEqual({});
    expect(rows[0].props).toBeNull();
  });
});

describe('computeJourneySummary — ordered funnel', () => {
  it('counts visitors reaching each step only if the steps happened in order', () => {
    const summary = run([
      // v1 walks the whole journey in order.
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00' }),
      ev({ name: 'audio_play', visitor_id: 'v1', ts: '2026-09-01 10:01:00' }),
      ev({ name: 'signup_success', visitor_id: 'v1', ts: '2026-09-01 10:02:00' }),
      ev({ name: 'checkout_start', visitor_id: 'v1', ts: '2026-09-01 10:03:00' }),
      // v2 only visits.
      ev({ name: 'page_view', visitor_id: 'v2', ts: '2026-09-02 10:00:00' }),
      // v3 listened without ever paging in (funnel stops at step 0).
      ev({ name: 'audio_play', visitor_id: 'v3', ts: '2026-09-03 10:00:00' }),
      // v4 signed up before their visit — the signup does not count.
      ev({ name: 'signup_success', visitor_id: 'v4', ts: '2026-09-04 08:00:00' }),
      ev({ name: 'page_view', visitor_id: 'v4', ts: '2026-09-04 09:00:00' }),
    ]);
    expect(summary.funnel.map((s) => s.visitors)).toEqual([3, 1, 1, 1]);
    expect(summary.funnel[0].key).toBe('visited');
    expect(summary.funnel[1].key).toBe('listened');
    expect(summary.funnel[2].key).toBe('account');
    expect(summary.funnel[3].key).toBe('checkout');
    expect(summary.funnel[1].stepRate).toBeCloseTo(1 / 3);
    expect(summary.funnel[3].stepRate).toBe(1);
  });

  it('treats login_success as reaching the account step', () => {
    const summary = run([
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00' }),
      ev({ name: 'login_success', visitor_id: 'v1', ts: '2026-09-01 10:05:00' }),
    ]);
    expect(summary.funnel.find((s) => s.key === 'account')?.visitors).toBe(1);
  });
});

describe('computeJourneySummary — daily series', () => {
  it('fills missing days with zeros and drops events outside the window', () => {
    const summary = run([
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-08-31 00:00:00' }), // window start, included
      ev({ name: 'page_view', visitor_id: 'v2', ts: '2026-09-02 12:00:00' }),
      ev({ name: 'page_view', visitor_id: 'v3', ts: '2026-09-06 23:00:00' }), // today
      ev({ name: 'page_view', visitor_id: 'v4', ts: '2026-08-30 23:59:59' }), // before window
      ev({ name: 'audio_play', visitor_id: 'v1', ts: '2026-08-31 00:05:00' }),
      ev({ name: 'signup_success', visitor_id: 'v2', ts: '2026-09-02 12:01:00' }),
    ]);
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily[0]).toEqual({
      date: '2026-08-31',
      visitors: 1,
      pageViews: 1,
      audioPlays: 1,
      signups: 0,
      logins: 0,
      checkouts: 0,
    });
    expect(summary.daily[1].pageViews).toBe(0); // gap day
    const sep2 = summary.daily.find((d) => d.date === '2026-09-02')!;
    expect(sep2).toEqual({
      date: '2026-09-02',
      visitors: 1,
      pageViews: 1,
      audioPlays: 0,
      signups: 1,
      logins: 0,
      checkouts: 0,
    });
    expect(summary.visitors).toBe(3);
    expect(summary.windowStart).toBe('2026-08-31');
  });

  it('returns a zeroed summary for no events', () => {
    const summary = run([]);
    expect(summary.visitors).toBe(0);
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.every((d) => d.visitors === 0 && d.pageViews === 0)).toBe(true);
    expect(summary.funnel.every((s) => s.visitors === 0)).toBe(true);
    expect(summary.topPaths).toEqual([]);
    expect(summary.experiments).toEqual([]);
    expect(summary.funnel[0].stepRate).toBeNull();
  });
});

describe('computeJourneySummary — paths, languages, totals', () => {
  it('aggregates top paths with unique visitors, sorted by views', () => {
    const summary = run([
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00', path: '/' }),
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:01:00', path: '/today' }),
      ev({ name: 'page_view', visitor_id: 'v2', ts: '2026-09-01 10:02:00', path: '/today' }),
      ev({ name: 'page_view', visitor_id: 'v3', ts: '2026-09-01 10:03:00', path: '/today' }),
      ev({ name: 'page_view', visitor_id: 'v4', ts: '2026-09-01 10:04:00', path: null }),
    ]);
    expect(summary.topPaths).toEqual([
      { path: '/today', views: 3, visitors: 2 },
      { path: '/', views: 1, visitors: 1 },
      { path: '(unknown)', views: 1, visitors: 1 },
    ]);
  });

  it('splits visitors by the first language they were seen with', () => {
    const summary = run([
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00', lang: 'zh' }),
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:01:00', lang: 'en' }),
      ev({ name: 'page_view', visitor_id: 'v2', ts: '2026-09-01 10:02:00', lang: 'en' }),
      ev({ name: 'page_view', visitor_id: 'v3', ts: '2026-09-01 10:03:00', lang: null }),
    ]);
    expect(summary.languages).toEqual([
      { lang: 'en', visitors: 1 },
      { lang: 'zh', visitors: 1 },
      { lang: '(unknown)', visitors: 1 },
    ]);
  });

  it('counts totals per event name', () => {
    const summary = run([
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 10:00:00' }),
      ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-01 11:00:00' }),
      ev({ name: 'audio_play', visitor_id: 'v1', ts: '2026-09-01 12:00:00' }),
      ev({ name: 'checkout_click', visitor_id: 'v1', ts: '2026-09-01 13:00:00' }),
    ]);
    expect(summary.totals).toEqual({ page_view: 2, audio_play: 1, checkout_click: 1 });
  });
});

describe('computeJourneySummary — experiments', () => {
  it('attributes visitors to their variant and reports per-variant conversions', () => {
    const summary = run([
      ev({
        name: 'page_view',
        visitor_id: 'v1',
        ts: '2026-09-01 10:00:00',
        variants: '{"signup_cta_copy":"invitation"}',
      }),
      ev({ name: 'signup_success', visitor_id: 'v1', ts: '2026-09-01 10:01:00' }),
      ev({
        name: 'page_view',
        visitor_id: 'v2',
        ts: '2026-09-01 11:00:00',
        variants: '{"signup_cta_copy":"control"}',
      }),
      ev({
        name: 'page_view',
        visitor_id: 'v3',
        ts: '2026-09-01 12:00:00',
        variants: '{"signup_cta_copy":"invitation"}',
      }),
      ev({ name: 'checkout_start', visitor_id: 'v3', ts: '2026-09-01 12:01:00' }),
      // v4 never saw the experiment.
      ev({ name: 'page_view', visitor_id: 'v4', ts: '2026-09-01 13:00:00' }),
    ]);
    expect(summary.experiments).toEqual([
      { experiment: 'signup_cta_copy', variant: 'invitation', visitors: 2, signups: 1, checkouts: 1 },
      { experiment: 'signup_cta_copy', variant: 'control', visitors: 1, signups: 0, checkouts: 0 },
    ]);
  });
});

describe('computeJourneySummary — new vs returning', () => {
  it('uses the first-ever sighting to split new and returning visitors', () => {
    const summary = run(
      [
        ev({ name: 'page_view', visitor_id: 'new', ts: '2026-09-05 10:00:00' }),
        ev({ name: 'page_view', visitor_id: 'old', ts: '2026-09-05 11:00:00' }),
      ],
      SEVEN_DAYS,
      new Map([
        ['new', '2026-09-05 10:00:00'],
        ['old', '2026-07-01 09:00:00'],
      ])
    );
    expect(summary.newVisitors).toBe(1);
    expect(summary.returningVisitors).toBe(1);
  });

  it('leaves the split null when no first-seen data was supplied', () => {
    const summary = run([ev({ name: 'page_view', visitor_id: 'v1', ts: '2026-09-05 10:00:00' })]);
    expect(summary.newVisitors).toBeNull();
    expect(summary.returningVisitors).toBeNull();
  });
});
