import type { Tier } from './entitlements';
import type { CreditBalance } from './credits';

export interface ReadingCtaState {
  /** True when no reading is possible today (quota exhausted and no trial credits left). */
  exhausted: boolean;
  /** Draws remaining today; null when the tier's quota is unlimited. */
  remaining: number | null;
  /** True when a free-tier account has unused multi-card trial credits. */
  hasTrialCredits: boolean;
}

/** Derive the account-page reading CTA state from values already loaded by the page. */
export function getReadingCtaState(args: {
  tier: Tier;
  usedToday: number;
  quota: number;
  creditBalance: CreditBalance | null;
}): ReadingCtaState {
  const { tier, usedToday, quota, creditBalance } = args;
  const hasTrialCredits =
    tier === 'free' &&
    !!creditBalance &&
    (creditBalance['3card'] > 0 || creditBalance.celtic_cross > 0);
  const unlimited = quota === Infinity;
  const remaining = unlimited ? null : Math.max(quota - usedToday, 0);
  const exhausted = !unlimited && usedToday >= quota && !hasTrialCredits;
  return { exhausted, remaining, hasTrialCredits };
}
