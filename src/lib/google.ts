// Google OAuth 2.0 helpers (authorization code flow, server-side)
// Endpoint URLs are overridable via env for local testing against a mock IdP;
// in production they default to the real Google endpoints.

export const GOOGLE_SCOPES = 'openid email profile';

/** Generate a random state value for CSRF protection (24 bytes, base64url). */
export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Constant-time string comparison to avoid timing side channels on state checks. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export interface GoogleAuthParams {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Override for tests/local mock; defaults to the real Google authorization endpoint. */
  authUrl?: string;
}

/** Build the Google authorization URL the user is redirected to. */
export function buildGoogleAuthUrl(p: GoogleAuthParams): URL {
  const url = new URL(p.authUrl ?? 'https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('state', p.state);
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('access_type', 'online');
  return url;
}

export interface TokenExchangeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Override for tests/local mock; defaults to the real Google token endpoint. */
  tokenUrl?: string;
}

/** Exchange the authorization code for an access token (server-to-server). */
export async function exchangeCodeForToken(p: TokenExchangeParams): Promise<{ accessToken: string; idToken: string | null }> {
  const body = new URLSearchParams({
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(p.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; id_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`Google token exchange failed: ${data.error ?? 'missing access_token'}`);
  }
  return { accessToken: data.access_token, idToken: data.id_token ?? null };
}

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

/** Fetch the authenticated user's profile from the Google userinfo endpoint. */
export async function fetchGoogleUserInfo(accessToken: string, userinfoUrl?: string): Promise<GoogleUserInfo> {
  const res = await fetch(userinfoUrl ?? 'https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
  };
  if (!data.sub || !data.email) throw new Error('Google userinfo missing sub/email');
  return {
    googleId: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: data.email_verified === true || data.email_verified === 'true',
    name: data.name ?? null,
    avatarUrl: data.picture ?? null,
  };
}
