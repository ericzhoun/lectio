// src/pages/api/auth/login.ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyUserCredentials } from '../../../lib/users';
import { createSessionToken } from '../../../lib/session';
import { safeAuthReturn } from '../../../lib/authReturn';
import { trackServerEvent } from '../../../lib/analytics';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const lang = form.get('lang') === 'en' ? 'en' : 'zh';
  const returnTo = safeAuthReturn(form.get('returnTo'), `/?lang=${lang}`);
  const json = request.headers.get('accept')?.includes('application/json');

  const userId = await verifyUserCredentials(email, password);
  if (!userId) {
    if (json) return Response.json({ error: 'invalid' }, { status: 401 });
    return redirect(`/login?${new URLSearchParams({ error: 'invalid', lang, returnTo })}`, 303);
  }

  const token = await createSessionToken(userId, env.SESSION_SECRET);
  cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
  await trackServerEvent({ name: 'login_success', cookies, userId });
  if (json) return Response.json({ returnTo });
  return redirect(returnTo, 303);
};
