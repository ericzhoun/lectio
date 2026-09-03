// GET /api/auth/google/callback — Google redirects here after authorization
// 1. Validates the `state` parameter against the cookie (CSRF protection).
// 2. Exchanges the authorization code for an access token (server-to-server).
// 3. Fetches the verified Google profile and upserts the user record.
// 4. Issues the signed session cookie and returns to the originating page.
// Every failure path redirects to /login with a friendly, retryable error;
// no user record is created until Google has verified the identity.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  constantTimeEqual,
  exchangeCodeForToken,
  fetchGoogleUserInfo,
} from '../../../../lib/google';
import { upsertGoogleUser } from '../../../../lib/users';
import { createSessionToken } from '../../../../lib/session';
import { safeAuthReturn } from '../../../../lib/authReturn';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const lang = cookies.get('oauth_lang')?.value === 'en' ? 'en' : 'zh';
  const returnTo = safeAuthReturn(cookies.get('oauth_return')?.value, `/?lang=${lang}`);
  const fail = (code: string) => redirect(`/login?${new URLSearchParams({ error: code, lang, returnTo })}`);

  const clearOAuthCookies = () => {
    cookies.delete('oauth_state', { path: '/api/auth/google/callback' });
    cookies.delete('oauth_lang', { path: '/api/auth/google/callback' });
    cookies.delete('oauth_return', { path: '/api/auth/google/callback' });
  };

  // User cancelled on Google's consent screen (or Google returned an error).
  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    clearOAuthCookies();
    return fail(errorParam === 'access_denied' ? 'cancelled' : 'oauth_failed');
  }

  // CSRF check: the state echoed by Google must match the one we issued.
  const state = url.searchParams.get('state');
  const storedState = cookies.get('oauth_state')?.value;
  clearOAuthCookies();
  if (!state || !storedState || !constantTimeEqual(state, storedState)) {
    return fail('invalid_state');
  }

  const code = url.searchParams.get('code');
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    return fail('oauth_failed');
  }

  const redirectUri = env.GOOGLE_REDIRECT_URI || new URL('/api/auth/google/callback', url).toString();

  try {
    const { accessToken } = await exchangeCodeForToken({
      code,
      clientId,
      clientSecret,
      redirectUri,
      tokenUrl: env.GOOGLE_TOKEN_URL,
    });
    const info = await fetchGoogleUserInfo(accessToken, env.GOOGLE_USERINFO_URL);

    // Only verified emails are linked/created; unverified profiles are rejected
    // so a Google account cannot claim an email it does not own.
    if (!info.emailVerified) {
      return fail('oauth_failed');
    }

    const { id } = await upsertGoogleUser({
      googleId: info.googleId,
      email: info.email,
      name: info.name,
      avatarUrl: info.avatarUrl,
    });

    const token = await createSessionToken(id, env.SESSION_SECRET);
    cookies.set('session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true });
    return redirect(returnTo);
  } catch (err) {
    console.error('Google OAuth callback failed:', err);
    return fail('oauth_failed');
  }
};
