import { describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', SESSION_SECRET: 'session' } }));
vi.mock('../google', () => ({
  generateOAuthState: () => 'test-state',
  buildGoogleAuthUrl: () => new URL('https://accounts.google.com/'),
  constantTimeEqual: (a: string, b: string) => a === b,
  exchangeCodeForToken: async () => ({ accessToken: 'test-token' }),
  fetchGoogleUserInfo: async () => ({ googleId: 'test', email: 'test@example.test', emailVerified: true }),
}));
vi.mock('../users', () => ({ upsertGoogleUser: async () => ({ id: 'user' }) }));
vi.mock('../session', () => ({ createSessionToken: async () => 'session-token' }));
import { GET as start } from '../../pages/api/auth/google/start';
import { GET as callback } from '../../pages/api/auth/google/callback';

describe('Google return destination', () => {
  it.each([false, true])('preserves the destination through OAuth (cancelled: %s)', async (cancelled) => {
    const values = new Map<string, string>();
    const cookies = {
      set: (key: string, value: string) => values.set(key, value),
      get: (key: string) => values.has(key) ? { value: values.get(key) } : undefined,
      delete: (key: string) => values.delete(key),
    };
    const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });
    const returnTo = '/library?lang=en#moon';
    await start({ url: new URL(`https://example.test/api/auth/google/start?${new URLSearchParams({ lang: 'en', returnTo })}`), cookies, redirect } as any);
    expect(values.get('oauth_return')).toBe(returnTo);
    const response = await callback({ url: new URL(`https://example.test/api/auth/google/callback?${cancelled ? 'error=access_denied' : 'state=test-state&code=code'}`), cookies, redirect } as any);
    if (cancelled) {
      const url = new URL(response.headers.get('location')!, 'https://example.test');
      expect(url.searchParams.get('returnTo')).toBe(returnTo);
      expect(url.searchParams.get('error')).toBe('cancelled');
      expect(values.has('session')).toBe(false);
    } else {
      expect(response.headers.get('location')).toBe(returnTo);
      expect(values.get('session')).toBe('session-token');
    }
    expect(values.has('oauth_return')).toBe(false);
  });
});
