import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getStripeClient } from '../../../lib/stripe';
import { verifySessionToken } from '../../../lib/session';
import { getSubscription } from '../../../lib/subscriptions';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, url }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  if (!userId) return redirect('/login');

  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) return redirect('/pricing');

  const stripe = getStripeClient(env.STRIPE_SECRET_KEY);
  // The account-wide default portal configuration is shared with other products, so use
  // the Lectio-specific one when STRIPE_PORTAL_CONFIG_ID is set.
  const configuration = env.STRIPE_PORTAL_CONFIG_ID || undefined;
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${url.origin}/account`,
    ...(configuration ? { configuration } : {}),
  });

  return redirect(portalSession.url);
};
