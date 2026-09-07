// User-journey analytics: turn raw analytics_events rows into the funnel,
// daily-activity, and slice aggregations shown on the /dashboard page.
//
// Everything here is pure so the shape of the numbers can be unit-tested
// (see __tests__/journey.test.ts); the dashboard page only adds the D1
// queries and access control. Timestamps are D1 CURRENT_TIMESTAMP strings
// ('YYYY-MM-DD HH:MM:SS', UTC) and compare correctly as strings.

import type { EventProps } from './analytics';

/** One row as it comes out of the analytics_events table. */
export interface RawEventRow {
  name: string | null;
  visitor_id: string | null;
  user_id?: string | null;
  path?: string | null;
  lang?: string | null;
  variants?: string | null;
  props?: string | null;
  ts?: string | null;
}

/** One normalized event, ready for aggregation. */
export interface JourneyEvent {
  name: string;
  visitorId: string;
  userId: string | null;
  path: string | null;
  lang: string | null;
  variants: Record<string, string>;
  props: EventProps | null;
  ts: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Normalize D1 rows; malformed rows are dropped (analytics never blocks the page). */
export function parseEventRows(rows: RawEventRow[]): JourneyEvent[] {
  const events: JourneyEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !row.name) continue;
    if (!row.visitor_id) continue;
    if (typeof row.ts !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.ts)) continue;
    events.push({
      name: row.name,
      visitorId: row.visitor_id,
      userId: row.user_id ?? null,
      path: row.path ?? null,
      lang: row.lang ?? null,
      variants: parseJson<Record<string, string>>(row.variants, {}),
      props: parseJson<EventProps>(row.props, null),
      ts: row.ts,
    });
  }
  return events;
}

// ---- Funnel definition ----------------------------------------------------
// An ordered funnel: a visitor reaches step k only if they did step k-1
// first, then an event matching step k. `login_success` counts for the
// account step too, so returning users are not invisible in the funnel.

export type FunnelKey = 'visited' | 'listened' | 'account' | 'checkout';

export const FUNNEL_LABELS: Record<FunnelKey, string> = {
  visited: 'Visited',
  listened: 'Listened',
  account: 'Signed in / up',
  checkout: 'Started checkout',
};

function matchesStep(key: FunnelKey, event: JourneyEvent): boolean {
  switch (key) {
    case 'visited':
      return event.name === 'page_view';
    case 'listened':
      return event.name === 'audio_play';
    case 'account':
      return event.name === 'signup_success' || event.name === 'login_success';
    case 'checkout':
      return event.name === 'checkout_start';
  }
}

const FUNNEL_KEYS: FunnelKey[] = ['visited', 'listened', 'account', 'checkout'];

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  visitors: number;
  /** Visitors at this step divided by all visitors in the window. */
  shareOfVisitors: number | null;
  /** Visitors at this step divided by visitors at the previous step. */
  stepRate: number | null;
}

export interface JourneyDay {
  date: string; // YYYY-MM-DD (UTC)
  visitors: number;
  pageViews: number;
  audioPlays: number;
  signups: number;
  logins: number;
  checkouts: number;
}

export interface PathStat {
  path: string;
  views: number;
  visitors: number;
}

export interface ExperimentStat {
  experiment: string;
  variant: string;
  visitors: number;
  signups: number;
  checkouts: number;
}

export interface JourneySummary {
  windowDays: number;
  /** First day (YYYY-MM-DD, UTC) included in the window, inclusive. */
  windowStart: string;
  totals: Record<string, number>;
  visitors: number;
  funnel: FunnelStep[];
  daily: JourneyDay[];
  topPaths: PathStat[];
  languages: { lang: string; visitors: number }[];
  experiments: ExperimentStat[];
  /** Null when no first-seen map was supplied. */
  newVisitors: number | null;
  returningVisitors: number | null;
}

export interface JourneyOptions {
  days: number;
  now?: Date;
  /** visitor_id -> first-ever event ts (whole table, not just the window). */
  firstSeen?: Map<string, string>;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeJourneySummary(events: JourneyEvent[], options: JourneyOptions): JourneySummary {
  const { days, now = new Date(), firstSeen } = options;
  const windowStart = utcDateKey(new Date(now.getTime() - (days - 1) * 86400_000));
  const windowStartTs = `${windowStart} 00:00:00`;
  const todayTs = `${utcDateKey(now)} 23:59:59`;

  const inWindow = events.filter((e) => e.ts >= windowStartTs && e.ts <= todayTs);

  // Per-visitor event list, chronological (stable for equal timestamps).
  const byVisitor = new Map<string, JourneyEvent[]>();
  for (const event of inWindow) {
    const list = byVisitor.get(event.visitorId);
    if (list) list.push(event);
    else byVisitor.set(event.visitorId, [event]);
  }
  for (const list of byVisitor.values()) list.sort((a, b) => a.ts.localeCompare(b.ts));

  const visitors = byVisitor.size;

  // Totals per event name.
  const totals: Record<string, number> = {};
  for (const event of inWindow) totals[event.name] = (totals[event.name] ?? 0) + 1;

  // Ordered funnel: walk each visitor's events, advancing through steps.
  const stepVisitors: Record<FunnelKey, number> = { visited: 0, listened: 0, account: 0, checkout: 0 };
  for (const list of byVisitor.values()) {
    let step = 0;
    for (const event of list) {
      if (step < FUNNEL_KEYS.length && matchesStep(FUNNEL_KEYS[step], event)) step++;
    }
    for (let i = 0; i < step; i++) stepVisitors[FUNNEL_KEYS[i]]++;
  }
  const funnel: FunnelStep[] = FUNNEL_KEYS.map((key, index) => ({
    key,
    label: FUNNEL_LABELS[key],
    visitors: stepVisitors[key],
    shareOfVisitors: visitors ? stepVisitors[key] / visitors : null,
    stepRate: index === 0 ? null : funnelZeroSafe(stepVisitors[key], stepVisitors[FUNNEL_KEYS[index - 1]]),
  }));

  // Daily series, zero-filled across the window.
  const dayIndex = new Map<string, number>();
  const daily: JourneyDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = utcDateKey(new Date(new Date(`${windowStart}T00:00:00Z`).getTime() + i * 86400_000));
    dayIndex.set(date, i);
    daily.push({ date, visitors: 0, pageViews: 0, audioPlays: 0, signups: 0, logins: 0, checkouts: 0 });
  }
  const dailyVisitors = new Set<string>();
  for (const event of inWindow) {
    const day = dayIndex.get(event.ts.slice(0, 10));
    if (day === undefined) continue;
    const row = daily[day];
    const visitorKey = `${day}:${event.visitorId}`;
    if (!dailyVisitors.has(visitorKey)) {
      dailyVisitors.add(visitorKey);
      row.visitors++;
    }
    if (event.name === 'page_view') row.pageViews++;
    else if (event.name === 'audio_play') row.audioPlays++;
    else if (event.name === 'signup_success') row.signups++;
    else if (event.name === 'login_success') row.logins++;
    else if (event.name === 'checkout_start') row.checkouts++;
  }

  // Top paths by page views.
  const pathStats = new Map<string, { views: number; visitors: Set<string> }>();
  for (const event of inWindow) {
    if (event.name !== 'page_view') continue;
    const path = event.path ?? '(unknown)';
    const stat = pathStats.get(path) ?? { views: 0, visitors: new Set<string>() };
    stat.views++;
    stat.visitors.add(event.visitorId);
    pathStats.set(path, stat);
  }
  const topPaths: PathStat[] = [...pathStats.entries()]
    .map(([path, { views, visitors: v }]) => ({ path, views, visitors: v.size }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, 10);

  // Language split by the first language seen per visitor.
  const langByVisitor = new Map<string, string>();
  for (const event of inWindow) {
    if (event.lang && !langByVisitor.has(event.visitorId)) langByVisitor.set(event.visitorId, event.lang);
  }
  const langCounts = new Map<string, number>();
  for (const visitorId of byVisitor.keys()) {
    const lang = langByVisitor.get(visitorId) ?? '(unknown)';
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const languages = [...langCounts.entries()]
    .map(([lang, count]) => ({ lang, visitors: count }))
    .sort((a, b) => b.visitors - a.visitors || a.lang.localeCompare(b.lang));

  // Experiment slices: visitors are attributed to every experiment they were
  // bucketed into; visitors without an assignment don't appear in the table.
  const accountVisitors = new Set<string>();
  const checkoutVisitors = new Set<string>();
  const signupVisitors = new Set<string>();
  for (const [visitorId, list] of byVisitor) {
    for (const event of list) {
      if (event.name === 'signup_success') signupVisitors.add(visitorId);
      else if (event.name === 'login_success') accountVisitors.add(visitorId);
      else if (event.name === 'checkout_start') checkoutVisitors.add(visitorId);
    }
  }
  for (const visitorId of signupVisitors) accountVisitors.add(visitorId);
  const expStats = new Map<string, ExperimentStat>();
  for (const [visitorId, list] of byVisitor) {
    const variants = list.find((e) => Object.keys(e.variants).length)?.variants;
    if (!variants) continue;
    for (const [experiment, variant] of Object.entries(variants)) {
      const key = `${experiment}\u0000${variant}`;
      const stat =
        expStats.get(key) ?? { experiment, variant, visitors: 0, signups: 0, checkouts: 0 };
      stat.visitors++;
      if (signupVisitors.has(visitorId)) stat.signups++;
      if (checkoutVisitors.has(visitorId)) stat.checkouts++;
      expStats.set(key, stat);
    }
  }
  const experiments = [...expStats.values()].sort(
    (a, b) => a.experiment.localeCompare(b.experiment) || b.visitors - a.visitors
  );

  // New vs returning: a visitor is new when their first-ever event (whole
  // table) falls inside this window. Requires the first-seen map; without it
  // the split stays null rather than guessing.
  let newVisitors: number | null = null;
  let returningVisitors: number | null = null;
  if (firstSeen) {
    newVisitors = 0;
    returningVisitors = 0;
    for (const visitorId of byVisitor.keys()) {
      const first = firstSeen.get(visitorId);
      if (first !== undefined && first < windowStartTs) returningVisitors++;
      else newVisitors++;
    }
  }

  return {
    windowDays: days,
    windowStart,
    totals,
    visitors,
    funnel,
    daily,
    topPaths,
    languages,
    experiments,
    newVisitors,
    returningVisitors,
  };
}

/** Rate with a safe zero denominator. */
function funnelZeroSafe(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}
