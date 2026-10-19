// GET /api/auth/google/start — begin Google sign-in
// Generates a CSRF state value, stores it in an httpOnly cookie scoped to the
// callback path, and redirects the user to Google's authorization endpoint.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildGoogleAuthUrl, generateOAuthState } from '../../../../lib/google';
import { safeAuthReturn } from '../../../../lib/authReturn';
import { resolveLang, langHref } from '../../../../lib/i18n';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  // English links carry no lang param (English is the canonical bare URL),
  // so resolve like the rest of the site: ?lang=zh > lang cookie > 'en'.
  const lang = resolveLang({ url, cookies });
  const returnTo = safeAuthReturn(url.searchParams.get('returnTo'), langHref('/', lang));
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
