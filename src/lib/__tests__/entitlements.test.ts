import { describe, it, expect } from 'vitest';
import {
  evaluateEntitlement,
  tierFromSubscription,
  SPREAD_ACCESS,
  QUOTA,
  ANON_DAILY_DRAWS,
  REGISTERED_DAILY_DRAWS,
} from '../entitlements';

const FREE = { tier: 'free', todayCount: 0, credits: { '3card': 0, celtic_cross: 0 } } as const;

describe('evaluateEntitlement — anonymous (cookie) visitors', () => {
  it('allows 3 single-card draws per day', () => {
    expect(evaluateEntitlement({ ...FREE, registered: false, spreadKey: 'single' })).toEqual({ ok: true });
    expect(
      evaluateEntitlement({ ...FREE, registered: false, todayCount: ANON_DAILY_DRAWS - 1, spreadKey: 'single' })
    ).toEqual({ ok: true });
  });

  it('blocks anonymous users at 3 draws/day', () => {
    expect(
      evaluateEntitlement({ ...FREE, registered: false, todayCount: ANON_DAILY_DRAWS, spreadKey: 'single' })
    ).toEqual({ ok: false, reason: 'quota' });
  });

  it('lets anonymous users draw multi-card spreads but keeps readings gated', () => {
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: false,
        credits: { '3card': 3, celtic_cross: 1 },
        spreadKey: '3card',
      })
    ).toEqual({ ok: true, gated: true });
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: false,
        credits: { '3card': 3, celtic_cross: 1 },
        spreadKey: 'celtic_cross',
      })
    ).toEqual({ ok: true, gated: true });
  });
});

describe('evaluateEntitlement — registered free users (registration perks)', () => {
  it('allows 6 single-card draws per day', () => {
    expect(evaluateEntitlement({ ...FREE, registered: true, spreadKey: 'single' })).toEqual({ ok: true });
    expect(
      evaluateEntitlement({ ...FREE, registered: true, todayCount: REGISTERED_DAILY_DRAWS - 1, spreadKey: 'single' })
    ).toEqual({ ok: true });
    expect(
      evaluateEntitlement({ ...FREE, registered: true, todayCount: REGISTERED_DAILY_DRAWS, spreadKey: 'single' })
    ).toEqual({ ok: false, reason: 'quota' });
  });

  it('lets registered users spend welcome credits on the 3-card spread', () => {
    expect(
      evaluateEntitlement({ ...FREE, registered: true, credits: { '3card': 2, celtic_cross: 0 }, spreadKey: '3card' })
    ).toEqual({ ok: true });
    expect(
      evaluateEntitlement({ ...FREE, registered: true, credits: { '3card': 0, celtic_cross: 0 }, spreadKey: '3card' })
    ).toEqual({ ok: false, reason: 'no_credits' });
  });

  it('lets registered users spend welcome credits on the Celtic Cross', () => {
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: true,
        credits: { '3card': 0, celtic_cross: 1 },
        spreadKey: 'celtic_cross',
      })
    ).toEqual({ ok: true });
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: true,
        credits: { '3card': 3, celtic_cross: 0 },
        spreadKey: 'celtic_cross',
      })
    ).toEqual({ ok: false, reason: 'no_credits' });
  });

  it('credit draws do not count against the daily quota and vice versa', () => {
    // Daily quota exhausted, but credits still allow multi-card draws
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: true,
        todayCount: REGISTERED_DAILY_DRAWS,
        credits: { '3card': 1, celtic_cross: 0 },
        spreadKey: '3card',
      })
    ).toEqual({ ok: true });
    // Credits exhausted but daily single draws still available
    expect(
      evaluateEntitlement({
        ...FREE,
        registered: true,
        todayCount: REGISTERED_DAILY_DRAWS,
        credits: { '3card': 0, celtic_cross: 0 },
        spreadKey: 'single',
      })
    ).toEqual({ ok: false, reason: 'quota' });
  });
});

describe('evaluateEntitlement — paid tiers (unchanged)', () => {
  it('allows basic tier 3card under quota', () => {
    expect(
      evaluateEntitlement({ tier: 'basic', registered: true, todayCount: 0, spreadKey: '3card', credits: { '3card': 0, celtic_cross: 0 } })
    ).toEqual({ ok: true });
  });

  it('blocks basic tier at daily quota', () => {
    expect(
      evaluateEntitlement({ tier: 'basic', registered: true, todayCount: QUOTA.basic, spreadKey: '3card', credits: { '3card': 0, celtic_cross: 0 } })
    ).toEqual({ ok: false, reason: 'quota' });
  });

  it('blocks basic tier from celtic_cross (credits do not apply to paid tiers)', () => {
    expect(
      evaluateEntitlement({ tier: 'basic', registered: true, todayCount: 0, spreadKey: 'celtic_cross', credits: { '3card': 5, celtic_cross: 5 } })
    ).toEqual({ ok: false, reason: 'spread_locked' });
  });

  it('allows pro tier celtic_cross with unlimited quota', () => {
    expect(
      evaluateEntitlement({ tier: 'pro', registered: true, todayCount: 10_000, spreadKey: 'celtic_cross', credits: { '3card': 0, celtic_cross: 0 } })
    ).toEqual({ ok: true });
  });

  it('every tier in SPREAD_ACCESS has a matching QUOTA entry', () => {
    expect(Object.keys(SPREAD_ACCESS).sort()).toEqual(Object.keys(QUOTA).sort());
  });
});

describe('tierFromSubscription — first-month-free trial access', () => {
  it('grants the paid tier while the subscription is trialing', () => {
    expect(tierFromSubscription({ tier: 'pro', status: 'trialing' })).toBe('pro');
    expect(tierFromSubscription({ tier: 'basic', status: 'trialing' })).toBe('basic');
  });

  it('keeps active subscriptions on their paid tier', () => {
    expect(tierFromSubscription({ tier: 'basic', status: 'active' })).toBe('basic');
    expect(tierFromSubscription({ tier: 'pro', status: 'active' })).toBe('pro');
  });

  it('falls back to free after the trial ends without a valid payment method', () => {
    expect(tierFromSubscription({ tier: 'pro', status: 'past_due' })).toBe('free');
    expect(tierFromSubscription({ tier: 'pro', status: 'unpaid' })).toBe('free');
    expect(tierFromSubscription({ tier: 'basic', status: 'canceled' })).toBe('free');
  });

  it('returns free for no subscription or an unknown tier name', () => {
    expect(tierFromSubscription(null)).toBe('free');
    expect(tierFromSubscription({ tier: 'enterprise', status: 'active' })).toBe('free');
  });
});
