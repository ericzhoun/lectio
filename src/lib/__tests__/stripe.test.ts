import { describe, it, expect } from 'vitest';
import { mapSubscriptionEvent } from '../stripe';
import type Stripe from 'stripe';

function checkoutCompletedEvent(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: 'user-123',
        customer: 'cus_abc',
        subscription: 'sub_abc',
        metadata: { tier: 'basic' },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionUpdatedEvent(status = 'active'): Stripe.Event {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_abc',
        customer: 'cus_abc',
        status,
        items: {
          data: [{ current_period_end: 1_800_000_000 }],
        },
        metadata: { tier: 'pro' },
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionCreatedEvent(status = 'trialing'): Stripe.Event {
  return {
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_abc',
        customer: 'cus_abc',
        status,
        items: {
          data: [{ current_period_end: 1_800_000_000 }],
        },
        metadata: { tier: 'basic' },
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionDeletedEvent(): Stripe.Event {
  return {
    type: 'customer.subscription.deleted',
    data: {
      object: { id: 'sub_abc', customer: 'cus_abc' },
    },
  } as unknown as Stripe.Event;
}

describe('mapSubscriptionEvent', () => {
  it('maps checkout.session.completed to an active subscription', () => {
    expect(mapSubscriptionEvent(checkoutCompletedEvent())).toEqual({
      tier: 'basic',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: null,
      userId: 'user-123',
    });
  });

  it('maps checkout.session.completed with a pro tier in session metadata', () => {
    expect(
      mapSubscriptionEvent(checkoutCompletedEvent({ metadata: { tier: 'pro' } }))
    ).toEqual({
      tier: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: null,
      userId: 'user-123',
    });
  });

  it('derives tier from the subscription price id when priceIds are provided, ignoring metadata', () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_abc',
          status: 'active',
          items: {
            data: [{ current_period_end: 1_800_000_000, price: { id: 'price_pro_123' } }],
          },
          // no metadata at all - portal-driven plan changes don't set subscription metadata
        },
      },
    } as unknown as Stripe.Event;

    expect(
      mapSubscriptionEvent(event, { basic: 'price_basic_123', pro: 'price_pro_123' })
    ).toEqual({
      tier: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      userId: null,
    });
  });

  it('resolves tier from an array of price IDs (monthly + annual)', () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_abc',
          customer: 'cus_abc',
          status: 'active',
          items: {
            data: [{ current_period_end: 1_800_000_000, price: { id: 'price_basic_annual_456' } }],
          },
        },
      },
    } as unknown as Stripe.Event;

    expect(
      mapSubscriptionEvent(event, {
        basic: ['price_basic_123', 'price_basic_annual_456'],
        pro: ['price_pro_123', 'price_pro_annual_789'],
      })
    ).toEqual({
      tier: 'basic',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      userId: null,
    });
  });

  it('maps customer.subscription.updated to its status and tier', () => {
    expect(mapSubscriptionEvent(subscriptionUpdatedEvent('active'))).toEqual({
      tier: 'pro',
      status: 'active',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      userId: null,
    });
  });

  it('maps customer.subscription.created like updated (free-trial subscriptions start trialing)', () => {
    expect(mapSubscriptionEvent(subscriptionCreatedEvent('trialing'))).toEqual({
      tier: 'basic',
      status: 'trialing',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: 'sub_abc',
      currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
      userId: null,
    });
  });

  it('maps customer.subscription.deleted to free/canceled', () => {
    expect(mapSubscriptionEvent(subscriptionDeletedEvent())).toEqual({
      tier: 'free',
      status: 'canceled',
      stripeCustomerId: 'cus_abc',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      userId: null,
    });
  });

  it('returns null for events it does not handle', () => {
    const event = { type: 'invoice.paid', data: { object: {} } } as unknown as Stripe.Event;
    expect(mapSubscriptionEvent(event)).toBeNull();
  });
});
