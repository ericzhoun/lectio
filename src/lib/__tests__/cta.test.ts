import { describe, it, expect } from 'vitest';
import { getReadingCtaState } from '../cta';

describe('getReadingCtaState', () => {
  it('free tier mid-day with credits: not exhausted, remaining draws, credits flagged', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 2,
        quota: 6,
        creditBalance: { '3card': 3, celtic_cross: 1 },
      })
    ).toEqual({ exhausted: false, remaining: 4, hasTrialCredits: true });
  });

  it('free tier quota exhausted with no credits: exhausted', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 6,
        quota: 6,
        creditBalance: { '3card': 0, celtic_cross: 0 },
      })
    ).toEqual({ exhausted: true, remaining: 0, hasTrialCredits: false });
  });

  it('free tier quota exhausted but trial credits remain: not exhausted', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 6,
        quota: 6,
        creditBalance: { '3card': 1, celtic_cross: 0 },
      })
    ).toEqual({ exhausted: false, remaining: 0, hasTrialCredits: true });
  });

  it('basic tier quota exhausted: exhausted', () => {
    expect(
      getReadingCtaState({ tier: 'basic', usedToday: 20, quota: 20, creditBalance: null })
    ).toEqual({ exhausted: true, remaining: 0, hasTrialCredits: false });
  });

  it('pro tier unlimited quota: never exhausted, remaining is null', () => {
    expect(
      getReadingCtaState({ tier: 'pro', usedToday: 42, quota: Infinity, creditBalance: null })
    ).toEqual({ exhausted: false, remaining: null, hasTrialCredits: false });
  });
});
