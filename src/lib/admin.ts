import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { getUserById } from './users';
import { ensureSubscriptionsTable } from './subscriptions';
import { ensureCreditsTable } from './credits';

// Bootstrap admins: these verified emails always have dashboard access, so
// the first admin never depends on a writable role column.
export const ADMIN_EMAILS = new Set(['ericzhouh@gmail.com']);

const PAID_TIERS = new Set(['basic', 'pro']);

/** True when the user id belongs to a dashboard admin (role column or bootstrap email). */
export async function isUserAdmin(userId: string | null, db: D1Database = env.DB): Promise<boolean> {
  if (!userId) return false;
  const user = await getUserById(userId, db);
  if (!user) return false;
  if (ADMIN_EMAILS.has(user.email.toLowerCase())) return true;
  return user.role === 'admin';
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  isAdmin: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  tier: string | null;
  subStatus: string | null;
  currentPeriodEnd: string | null;
  credits: { '3card': number; celtic_cross: number };
}

/** Joined user + subscription + credits snapshot for the admin dashboard table. */
export async function listAdminUsers(limit = 200, db: D1Database = env.DB): Promise<AdminUserRow[]> {
  await ensureSubscriptionsTable(db);
  await ensureCreditsTable(db);
  const result = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at,
              s.tier, s.status, s.current_period_end,
              COALESCE(c.credit_3card, 0) AS credit_3card,
              COALESCE(c.credit_celtic, 0) AS credit_celtic
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       LEFT JOIN welcome_credits c ON c.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{
      id: string;
      email: string;
      name: string | null;
      role: string | null;
      created_at: string | null;
      last_login_at: string | null;
      tier: string | null;
      status: string | null;
      current_period_end: string | null;
      credit_3card: number;
      credit_celtic: number;
    }>();
  return (result.results ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    isAdmin: r.role === 'admin' || ADMIN_EMAILS.has(r.email.toLowerCase()),
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    tier: r.tier,
    subStatus: r.status,
    currentPeriodEnd: r.current_period_end,
    credits: { '3card': r.credit_3card, celtic_cross: r.credit_celtic },
  }));
}

export function isPaidTier(tier: string | null): boolean {
  return tier !== null && PAID_TIERS.has(tier);
}
