import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: { SESSION_SECRET: 'test-secret' } }));
vi.mock('../../lib/session', () => ({ verifySessionToken: vi.fn() }));
vi.mock('../../lib/admin', () => ({
  isUserAdmin: vi.fn(),
  listAdminUsers: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../lib/subscriptions', () => ({
  getSubscription: vi.fn().mockResolvedValue(null),
  upsertSubscription: vi.fn(),
}));
vi.mock('../../lib/credits', () => ({ setCreditBalance: vi.fn() }));
vi.mock('../../lib/users', () => ({ setUserRole: vi.fn() }));
import { verifySessionToken } from '../../lib/session';
import { isUserAdmin, listAdminUsers } from '../../lib/admin';
import { upsertSubscription, getSubscription } from '../../lib/subscriptions';
import { setCreditBalance } from '../../lib/credits';
import { setUserRole } from '../../lib/users';
import { GET, POST } from '../../pages/api/admin/users';

function makeContext(body?: URLSearchParams) {
  return {
    cookies: { get: (name: string) => (name === 'session' ? { value: 'tok' } : undefined) },
    request: new Request('https://example.test/api/admin/users', {
      method: body ? 'POST' : 'GET',
      body,
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    }),
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { Location: location } }),
  } as any;
}

describe('admin users route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifySessionToken).mockResolvedValue('acting-admin-id');
    vi.mocked(isUserAdmin).mockResolvedValue(true);
  });

  it('rejects anonymous and non-admin visitors with 403', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue(null);
    vi.mocked(isUserAdmin).mockResolvedValue(false);
    expect((await GET(makeContext())).status).toBe(403);
    expect((await POST(makeContext(new URLSearchParams({ userId: 'u1', action: 'set_tier', tier: 'pro' })))).status).toBe(403);
    expect(listAdminUsers).not.toHaveBeenCalled();
  });

  it('returns the joined user list for an admin', async () => {
    const res = await GET(makeContext());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [] });
  });

  it('changes a subscription tier while preserving status', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      tier: 'free',
      status: 'trialing',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: '2030-01-01',
    } as any);
    const res = await POST(makeContext(new URLSearchParams({ userId: 'u1', action: 'set_tier', tier: 'pro' })));
    expect(res.status).toBe(303);
    expect(upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tier: 'pro', status: 'trialing' })
    );
  });

  it('rejects an unknown tier', async () => {
    const res = await POST(makeContext(new URLSearchParams({ userId: 'u1', action: 'set_tier', tier: 'gold' })));
    expect(res.status).toBe(400);
    expect(upsertSubscription).not.toHaveBeenCalled();
  });

  it('overwrites trial credit balances with non-negative integers', async () => {
    const res = await POST(
      makeContext(new URLSearchParams({ userId: 'u1', action: 'set_credits', credit3card: '5', creditCeltic: '2' }))
    );
    expect(res.status).toBe(303);
    expect(setCreditBalance).toHaveBeenCalledWith('u1', { '3card': 5, celtic_cross: 2 });
  });

  it('grants and revokes the admin role', async () => {
    const grant = await POST(makeContext(new URLSearchParams({ userId: 'u2', action: 'set_role', role: 'admin' })));
    expect(grant.status).toBe(303);
    expect(setUserRole).toHaveBeenCalledWith('u2', 'admin');
    const revoke = await POST(makeContext(new URLSearchParams({ userId: 'u3', action: 'set_role', role: 'user' })));
    expect(revoke.status).toBe(303);
    expect(setUserRole).toHaveBeenCalledWith('u3', 'user');
  });

  it('refuses to let the acting admin revoke their own access', async () => {
    const res = await POST(makeContext(new URLSearchParams({ userId: 'acting-admin-id', action: 'set_role', role: 'user' })));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });
});
