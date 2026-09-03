import Stripe from 'stripe';

/** Free-trial length for new monthly subscriptions: the first month is free. */
export const FIRST_MONTH_TRIAL_DAYS = 30;

/** Subscription statuses that grant paid-tier access (trial users keep full plan features). */
export const PAID_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export function getStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
  });
}

export interface MappedSubscription {
  tier: 'free' | 'basic' | 'pro';
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  userId: string | null;
}

export function mapSubscriptionEvent(
  event: Stripe.Event,
  priceIds?: { basic: string | string[]; pro: string | string[] }
): MappedSubscription | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const tier = (session.metadata?.tier as 'basic' | 'pro' | undefined) ?? 'basic';
      return {
        tier,
        status: 'active',
        stripeCustomerId: String(session.customer),
        stripeSubscriptionId: session.subscription ? String(session.subscription) : null,
        currentPeriodEnd: null,
        userId: session.client_reference_id ?? null,
      };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      let tier: 'basic' | 'pro';
      if (priceIds) {
        const priceId = sub.items?.data?.[0]?.price?.id;
        const proIds = Array.isArray(priceIds.pro) ? priceIds.pro : [priceIds.pro];
        tier = proIds.includes(priceId) ? 'pro' : 'basic';
      } else {
        tier = (sub.metadata?.tier as 'basic' | 'pro' | undefined) ?? 'basic';
      }
      const currentPeriodEnd = sub.items?.data?.[0]?.current_period_end;
      return {
        tier,
        status: sub.status,
        stripeCustomerId: String(sub.customer),
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: currentPeriodEnd
          ? new Date(currentPeriodEnd * 1000).toISOString()
          : null,
        userId: null,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        tier: 'free',
        status: 'canceled',
        stripeCustomerId: String(sub.customer),
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        userId: null,
      };
    }
    default:
      return null;
  }
}
