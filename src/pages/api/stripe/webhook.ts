import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getStripeClient, mapSubscriptionEvent } from '../../../lib/stripe';
import { upsertSubscription } from '../../../lib/subscriptions';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();
  if (!signature) return new Response('missing signature', { status: 400 });

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }

  const mapped = mapSubscriptionEvent(event, {
    basic: [env.STRIPE_PRICE_BASIC, env.STRIPE_PRICE_BASIC_ANNUAL].filter(Boolean),
    pro: [env.STRIPE_PRICE_PRO, env.STRIPE_PRICE_PRO_ANNUAL].filter(Boolean),
  });
  if (!mapped) return new Response('ignored', { status: 200 });

  // checkout.session.completed carries the userId directly; subscription.updated/deleted
  // only carry the Stripe customer id, so look up the existing row by customer id via a
  // linear scan is avoided by requiring checkout to have run first and storing the
  // customer id on that row - resolve userId from the existing subscription record.
  let userId = mapped.userId;
  if (!userId) {
    const existing = await findSubscriptionByCustomerId(mapped.stripeCustomerId);
    userId = existing;
  }
  if (!userId) return new Response('unknown customer', { status: 200 });

  // checkout.session.completed may fire before/after customer.subscription.created
  // (with a free trial the subscription starts as 'trialing'). Snapshot the real
  // status and period end from Stripe so the local row is accurate immediately.
  let status = mapped.status;
  let currentPeriodEnd = mapped.currentPeriodEnd ?? undefined;
  if (event.type === 'checkout.session.completed' && mapped.stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(mapped.stripeSubscriptionId);
    status = sub.status;
    const periodEnd = sub.items?.data?.[0]?.current_period_end;
    if (periodEnd) currentPeriodEnd = new Date(periodEnd * 1000).toISOString();
  }

  await upsertSubscription({
    userId,
    tier: mapped.tier,
    status,
    stripeCustomerId: mapped.stripeCustomerId,
    stripeSubscriptionId: mapped.stripeSubscriptionId ?? undefined,
    currentPeriodEnd,
  });

  return new Response('ok', { status: 200 });
};

async function findSubscriptionByCustomerId(stripeCustomerId: string): Promise<string | null> {
  const { env: cfEnv } = await import('cloudflare:workers');
  const row = await cfEnv.DB
    .prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?')
    .bind(stripeCustomerId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}
