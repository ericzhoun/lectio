import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: { SESSION_SECRET: 'test-secret' } }));
vi.mock('../users', () => ({ verifyUserCredentials: vi.fn() }));
vi.mock('../session', () => ({ createSessionToken: vi.fn().mockResolvedValue('signed-session') }));
vi.mock('../dailySession', () => ({ claimGuestWalk: vi.fn() }));
import { verifyUserCredentials } from '../users';
import { claimGuestWalk } from '../dailySession';
import { POST } from '../../pages/api/auth/login';

async function login(returnTo: string, json = false) {
  const cookies = { set: vi.fn(), get: vi.fn().mockReturnValue({ value: 'visitor-1' }) };
  const response = await POST({
    request: new Request('https://example.test/api/auth/login', {
      method: 'POST', body: new URLSearchParams({ email: 'user@example.test', password: 'test-password', lang: 'en', returnTo }),
      headers: json ? { Accept: 'application/json' } : {},
    }), cookies,
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as any);
  return { response, cookies };
}
describe('email login return flow', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(verifyUserCredentials).mockResolvedValue('user-id'); });
  it('returns to the exact original page after a normal form submission', async () => {
    const { response, cookies } = await login('/library?lang=en#moon');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/library?lang=en#moon');
    expect(cookies.set).toHaveBeenCalledWith('session', 'signed-session', expect.objectContaining({ httpOnly: true }));
  });
  it('claims the guest walk for the account that just signed in', async () => {
    await login('/today/amen');
    expect(claimGuestWalk).toHaveBeenCalledWith('guest:visitor-1', 'user-id');
  });

  it('supplies the return destination to the overlay after creating a session', async () => {
    const { response, cookies } = await login('/pricing?lang=en', true);
    expect(await response.json()).toEqual({ returnTo: '/pricing?lang=en' });
    expect(cookies.set).toHaveBeenCalled();
  });
  it('keeps an invalid-password error in the overlay without creating a session', async () => {
    vi.mocked(verifyUserCredentials).mockResolvedValue(null);
    const { response, cookies } = await login('/library', true);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid' });
    expect(cookies.set).not.toHaveBeenCalled();
  });
  it('preserves the return destination and language on a failed normal submission', async () => {
    vi.mocked(verifyUserCredentials).mockResolvedValue(null);
    const { response } = await login('/library?lang=en');
    const url = new URL(response.headers.get('location')!, 'https://example.test');
    expect(url.searchParams.get('returnTo')).toBe('/library?lang=en');
    expect(url.searchParams.get('lang')).toBe('en');
  });
  it('does not redirect to an external destination', async () => {
    const { response } = await login('//evil.test');
    expect(response.headers.get('location')).toBe('/?lang=en');
  });
});
