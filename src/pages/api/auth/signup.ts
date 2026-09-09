// src/pages/api/auth/signup.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createUser } from '../../../lib/users';
import { createSessionToken } from '../../../lib/session';
import { resolveLang } from '../../../lib/i18n';
import { safeAuthReturn } from '../../../lib/authReturn';
import { trackServerEvent } from '../../../lib/analytics';
import { claimGuestWalk } from '../../../lib/dailySession';
import { guestReaderId } from '../../../lib/guestSession';

export const prerender = false;

export const POST: APIRoute = async ({ request, url, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  const lang = form.get('lang') === 'en' ? 'en' : resolveLang({ url, cookies });
  const returnTo = safeAuthReturn(form.get('returnTo'), `/?lang=${lang}`);

  if (!email || password.length < 8) {
    return redirect(`/signup?${new URLSearchParams({ error: 'invalid', lang, returnTo })}`, 303);
  }

  const result = await createUser(email, password);
  if ('error' in result) {
    return redirect(`/signup?${new URLSearchParams({ error: 'duplicate', lang, returnTo })}`, 303);
  }

  // Whatever they walked through as a guest becomes theirs to keep.
  const vid = cookies.get('vid')?.value;
  if (vid) await claimGuestWalk(guestReaderId(vid), result.id);

  const token = await createSessionToken(result.id, env.SESSION_SECRET);
  cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  await trackServerEvent({ name: 'signup_success', cookies, userId: result.id });
  return redirect(returnTo, 303);
};
