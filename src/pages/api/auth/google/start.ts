// GET /api/auth/google/start — begin Google sign-in
// Generates a CSRF state value, stores it in an httpOnly cookie scoped to the
// callback path, and redirects the user to Google's authorization endpoint.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildGoogleAuthUrl, generateOAuthState } from '../../../../lib/google';
import { safeAuthReturn } from '../../../../lib/authReturn';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh';
  const returnTo = safeAuthReturn(url.searchParams.get('returnTo'), `/?lang=${lang}`);
  if (!clientId || !clientSecret) {
    return redirect(`/login?${new URLSearchParams({ error: 'config', lang, returnTo })}`);
  }

  const state = generateOAuthState();
  const redirectUri = env.GOOGLE_REDIRECT_URI || new URL('/api/auth/google/callback', url).toString();

  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri,
    state,
    authUrl: env.GOOGLE_AUTH_URL,
  });

  cookies.set('oauth_state', state, {
    path: '/api/auth/google/callback',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600, // 10 minutes
  });
  cookies.set('oauth_lang', lang, {
    path: '/api/auth/google/callback',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 600,
  });

  cookies.set('oauth_return', returnTo, {
    path: '/api/auth/google/callback', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600,
  });
  return redirect(authUrl.toString());
};
