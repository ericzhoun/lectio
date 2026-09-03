import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildGoogleAuthUrl,
  constantTimeEqual,
  exchangeCodeForToken,
  fetchGoogleUserInfo,
  generateOAuthState,
  GOOGLE_SCOPES,
} from '../google';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateOAuthState', () => {
  it('produces a long random base64url value', () => {
    const s = generateOAuthState();
    expect(s.length).toBeGreaterThanOrEqual(30);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different values per call', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});

describe('constantTimeEqual', () => {
  it('compares equal strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different strings and lengths', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});

describe('buildGoogleAuthUrl', () => {
  it('includes all required OAuth parameters', () => {
    const url = buildGoogleAuthUrl({
      clientId: 'client-123.apps.googleusercontent.com',
      redirectUri: 'https://inspire.example/api/auth/google/callback',
      state: 'state-xyz',
    });
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://inspire.example/api/auth/google/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES);
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('supports a mock auth endpoint override', () => {
    const url = buildGoogleAuthUrl({
      clientId: 'c',
      redirectUri: 'r',
      state: 's',
      authUrl: 'http://localhost:9000/auth',
    });
    expect(url.toString()).toContain('http://localhost:9000/auth?');
  });
});

describe('exchangeCodeForToken', () => {
  it('exchanges a code for an access token', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'at-1', id_token: 'id-1', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCodeForToken({
      code: 'code-1',
      clientId: 'client-123',
      clientSecret: 'secret-1',
      redirectUri: 'https://inspire.example/api/auth/google/callback',
    });

    expect(result.accessToken).toBe('at-1');
    expect(result.idToken).toBe('id-1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('code')).toBe('code-1');
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('client_secret')).toBe('secret-1');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('throws on non-OK token response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 400 }))
    );
    await expect(
      exchangeCodeForToken({
        code: 'c',
        clientId: 'cid',
        clientSecret: 'cs',
        redirectUri: 'r',
      })
    ).rejects.toThrow(/HTTP 400/);
  });

  it('throws when the token response lacks an access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    await expect(
      exchangeCodeForToken({ code: 'c', clientId: 'cid', clientSecret: 'cs', redirectUri: 'r' })
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe('fetchGoogleUserInfo', () => {
  it('parses a verified Google profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            sub: 'google-sub-1',
            name: 'Test User',
            email: 'Test.User@Example.com',
            email_verified: true,
            picture: 'https://example.com/avatar.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const info = await fetchGoogleUserInfo('at-1');
    expect(info.googleId).toBe('google-sub-1');
    expect(info.email).toBe('test.user@example.com'); // normalized to lowercase
    expect(info.emailVerified).toBe(true);
    expect(info.name).toBe('Test User');
    expect(info.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('parses email_verified as a string too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ sub: 's', email: 'a@b.co', email_verified: 'true' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const info = await fetchGoogleUserInfo('at');
    expect(info.emailVerified).toBe(true);
  });

  it('throws when sub or email is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ name: 'No Id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    await expect(fetchGoogleUserInfo('at')).rejects.toThrow(/sub\/email/);
  });

  it('throws on non-OK userinfo response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 }))
    );
    await expect(fetchGoogleUserInfo('at')).rejects.toThrow(/HTTP 401/);
  });
});
