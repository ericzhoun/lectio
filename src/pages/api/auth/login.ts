// src/pages/api/auth/login.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyUserCredentials } from '../../../lib/users';
import { createSessionToken, SESSION_COOKIE_MAX_AGE } from '../../../lib/session';
import { safeAuthReturn } from '../../../lib/authReturn';
import { langHref } from '../../../lib/i18n';
import { trackServerEvent } from '../../../lib/analytics';
import { claimGuestWalk } from '../../../lib/dailySession';
import { guestReaderId } from '../../../lib/guestSession';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  // English is the canonical default now that English links are bare (they no
  // longer carry ?lang=en); only an explicit zh flips the error-page language.
  const lang = form.get('lang') === 'zh' ? 'zh' : 'en';
  const returnTo = safeAuthReturn(form.get('returnTo'), langHref('/', lang));
  const json = request.headers.get('accept')?.includes('application/json');

  const userId = await verifyUserCredentials(email, password);
  if (!userId) {
    await trackServerEvent({ name: 'login_failure', cookies, props: { via: json ? 'overlay' : 'page' } });
    if (json) return Response.json({ error: 'invalid' }, { status: 401 });
    return redirect(`/login?${new URLSearchParams({ error: 'invalid', lang, returnTo })}`, 303);
  }

  // Whatever they walked through as a guest becomes theirs to keep.
  const vid = cookies.get('vid')?.value;
  if (vid) await claimGuestWalk(guestReaderId(vid), userId);

  const token = await createSessionToken(userId, env.SESSION_SECRET);
  cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: SESSION_COOKIE_MAX_AGE });
  await trackServerEvent({ name: 'login_success', cookies, userId, request });
  if (json) return Response.json({ returnTo });
  return redirect(returnTo, 303);
};
