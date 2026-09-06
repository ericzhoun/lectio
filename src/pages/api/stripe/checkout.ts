import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { env } from 'cloudflare:workers';
import { getStripeClient, FIRST_MONTH_TRIAL_DAYS } from '../../../lib/stripe';
import { getSubscription } from '../../../lib/subscriptions';
import { verifySessionToken } from '../../../lib/session';
import { trackServerEvent } from '../../../lib/analytics';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  if (!userId) return redirect('/login');

  const form = await request.formData();
  const tier = String(form.get('tier') ?? '');
  const billing = String(form.get('billing') ?? 'monthly');
  let priceId: string | null = null;
  if (tier === 'pro') {
    priceId = billing === 'annual' ? env.STRIPE_PRICE_PRO_ANNUAL : env.STRIPE_PRICE_PRO;
  } else if (tier === 'basic') {
    priceId = billing === 'annual' ? env.STRIPE_PRICE_BASIC_ANNUAL : env.STRIPE_PRICE_BASIC;
  }
  if (!priceId) return redirect('/pricing?error=invalid_tier');

  // First month free: monthly checkouts start with a 30-day trial. One trial
  // per account — cancelled subscriptions keep their stripe_subscription_id
  // in the local row (COALESCE upsert), so its presence means "already tried".
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { tier, billing },
  };
  if (billing === 'monthly') {
    const prior = await getSubscription(userId);
    if (!prior?.stripeSubscriptionId) {
      subscriptionData.trial_period_days = FIRST_MONTH_TRIAL_DAYS;
    }
  }

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: subscriptionData,
    metadata: { tier, billing },
    success_url: `${url.origin}/account?checkout=success`,
    cancel_url: `${url.origin}/pricing?checkout=cancelled`,
  });
  await trackServerEvent({ name: 'checkout_start', cookies, userId, props: { tier, billing } });

  return redirect(checkoutSession.url ?? '/pricing');
};
