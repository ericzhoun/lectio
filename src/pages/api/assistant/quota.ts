// src/pages/api/assistant/quota.ts
// Lazy quota lookup: the widget fetches this only when the panel first opens.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ANON_DAILY_MESSAGES, chatQuotaFor, evaluateChatQuota } from '../../../lib/assistant';
import { getChatUsage } from '../../../lib/chatUsage';
import { verifySessionToken } from '../../../lib/session';
import { resolveTier } from '../../../lib/entitlements';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

  let registered = false;
  let tier: 'free' | 'basic' | 'pro' = 'free';
  let visitorKey = '';
  if (userId) {
    registered = true;
    tier = await resolveTier(userId);
    visitorKey = `u:${userId}`;
  } else {
    visitorKey = cookies.get('chat_anon')?.value ?? '';
  }

  const used = visitorKey ? await getChatUsage(visitorKey, env.DB) : 0;
  const visitor = { registered, tier };
  const quota = evaluateChatQuota(visitor, used);
  return new Response(
    JSON.stringify({
      ok: quota.ok,
      remaining: quota.remaining,
      limit: chatQuotaFor(visitor),
      registered,
      tier,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};
