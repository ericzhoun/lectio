// src/pages/api/admin/users.ts
// Admin dashboard endpoints. Every request must carry a valid session cookie
// belonging to an admin (see src/lib/admin.ts).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../../../lib/session';
import { isUserAdmin, listAdminUsers } from '../../../lib/admin';
import { upsertSubscription, getSubscription } from '../../../lib/subscriptions';
import { setCreditBalance } from '../../../lib/credits';
import { setUserRole } from '../../../lib/users';

export const prerender = false;

const VALID_TIERS = new Set(['free', 'basic', 'pro']);

async function requireAdmin(cookies: {
  get: (name: string) => { value: string } | undefined;
}): Promise<boolean> {
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  return isUserAdmin(userId);
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!(await requireAdmin(cookies))) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const users = await listAdminUsers();
  return Response.json({ users });
};

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!(await requireAdmin(cookies))) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const form = await request.formData();
  const userId = String(form.get('userId') ?? '');
  const action = String(form.get('action') ?? '');
  if (!userId) return Response.json({ error: 'missing_user' }, { status: 400 });

  switch (action) {
    case 'set_tier': {
      const tier = String(form.get('tier') ?? '');
      if (!VALID_TIERS.has(tier)) return Response.json({ error: 'invalid_tier' }, { status: 400 });
      const existing = await getSubscription(userId);
      await upsertSubscription({
        userId,
        tier,
        status: existing?.status ?? 'active',
        currentPeriodEnd: tier === 'free' ? undefined : existing?.currentPeriodEnd ?? undefined,
      });
      break;
    }
    case 'set_credits': {
      await setCreditBalance(userId, {
        '3card': Number(form.get('credit3card') ?? 0) || 0,
        celtic_cross: Number(form.get('creditCeltic') ?? 0) || 0,
      });
      break;
    }
    case 'set_role': {
      const role = String(form.get('role') ?? '');
      if (role !== 'user' && role !== 'admin') {
        return Response.json({ error: 'invalid_role' }, { status: 400 });
      }
      // Never let the dashboard revoke the acting admin's own access.
      if (role === 'user') {
        const sessionCookie = cookies.get('session')?.value;
        const actingId = sessionCookie
          ? await verifySessionToken(sessionCookie, env.SESSION_SECRET)
          : null;
        if (actingId === userId) {
          return Response.json({ error: 'cannot_demote_self' }, { status: 400 });
        }
      }
      await setUserRole(userId, role);
      break;
    }
    default:
      return Response.json({ error: 'unknown_action' }, { status: 400 });
  }

  return redirect('/admin', 303);
};
