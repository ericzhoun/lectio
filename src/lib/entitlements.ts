import { getSubscription } from './subscriptions';
import { PAID_SUBSCRIPTION_STATUSES } from './stripe';
import { getTodayUsage, incrementUsage } from './usage';
import { ensureWelcomeCredits, consumeCredit, type CreditBalance, type CreditSpread } from './credits';

export type Tier = 'free' | 'basic' | 'pro';

export const SPREAD_ACCESS: Record<Tier, string[]> = {
  free: ['single'],
  basic: ['single', '3card'],
  pro: ['single', '3card', 'celtic_cross'],
};

/** Daily single-card draws for anonymous visitors (identified by cookie). */
export const ANON_DAILY_DRAWS = 3;
/** Daily single-card draws for registered free users — registration perk. */
export const REGISTERED_DAILY_DRAWS = 6;

/** Daily draw quota for registered users by tier. */
export const QUOTA: Record<Tier, number> = {
  free: REGISTERED_DAILY_DRAWS,
  basic: 20,
  pro: Infinity,
};

export type EntitlementResult =
  | { ok: true; /** True when the draw may proceed but the reading requires registration. */ gated?: boolean }
  | { ok: false; reason: 'quota' | 'spread_locked' | 'no_credits' };

export interface EntitlementInput {
  tier: Tier;
  /** True when the visitor is signed in; anonymous cookie users are not registered. */
  registered: boolean;
  todayCount: number;
  spreadKey: string;
  credits: CreditBalance;
}

export function evaluateEntitlement({
  tier,
  registered,
  todayCount,
  spreadKey,
  credits,
}: EntitlementInput): EntitlementResult {
  if (tier === 'free') {
    if (spreadKey === 'single') {
      const limit = registered ? REGISTERED_DAILY_DRAWS : ANON_DAILY_DRAWS;
      return todayCount >= limit ? { ok: false, reason: 'quota' } : { ok: true };
    }
    // Multi-card spreads: both use the "draw now, register to reveal" flow —
    // the visitor may draw (gated: no interpretation until they register, at
    // which point revealing spends a welcome credit). The gate is mode-
    // agnostic: index.astro renders card fans for tarot and the Bible flip
    // for Bible mode, keyed by the shared spread keys.
    if (!registered) {
      return spreadKey === '3card' || spreadKey === 'celtic_cross'
        ? { ok: true, gated: true }
        : { ok: false, reason: 'spread_locked' };
    }
    return (credits[spreadKey as CreditSpread] ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: 'no_credits' };
  }

  if (!SPREAD_ACCESS[tier].includes(spreadKey)) {
    return { ok: false, reason: 'spread_locked' };
  }
  if (todayCount >= QUOTA[tier]) {
    return { ok: false, reason: 'quota' };
  }
  return { ok: true };
}

/** Map a stored subscription row to the effective tier; trialing counts as paid. */
export function tierFromSubscription(sub: {
  tier: string;
  status: string;
} | null): Tier {
  if (!sub || !PAID_SUBSCRIPTION_STATUSES.has(sub.status)) return 'free';
  if (sub.tier === 'basic' || sub.tier === 'pro') return sub.tier;
  return 'free';
}

export async function resolveTier(userId: string): Promise<Tier> {
  return tierFromSubscription(await getSubscription(userId));
}

export async function canDraw(
  userId: string,
  spreadKey: string,
  registered: boolean
): Promise<EntitlementResult> {
  const tier = registered ? await resolveTier(userId) : 'free';
  const todayCount = await getTodayUsage(userId);
  // Registered accounts get the one-time welcome credits; the grant is
  // idempotent, so this also backfills accounts created before the perk.
  const credits = registered ? await ensureWelcomeCredits(userId) : { '3card': 0, celtic_cross: 0 };
  return evaluateEntitlement({ tier, registered, todayCount, spreadKey, credits });
}

export async function recordDraw(userId: string, spreadKey: string, registered: boolean): Promise<void> {
  if (registered) {
    const tier = await resolveTier(userId);
    if (tier === 'free' && spreadKey !== 'single') {
      await consumeCredit(userId, spreadKey as CreditSpread);
      return; // credit draws do not consume the daily single-card quota
    }
  }
  await incrementUsage(userId);
}
