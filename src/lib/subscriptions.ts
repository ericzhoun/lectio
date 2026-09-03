import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end DATETIME
)`;

let initialized = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL.replace(/\n\s*/g, ' '));
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id)'
  );
  initialized = true;
}

export interface SubscriptionRow {
  tier: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const db = env.DB;
  await ensureTable(db);
  const row = await db
    .prepare(
      'SELECT tier, status, stripe_customer_id, stripe_subscription_id, current_period_end FROM subscriptions WHERE user_id = ?'
    )
    .bind(userId)
    .first<{
      tier: string;
      status: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      current_period_end: string | null;
    }>();
  if (!row) return null;
  return {
    tier: row.tier,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end,
  };
}

export async function upsertSubscription(params: {
  userId: string;
  tier: string;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
}): Promise<void> {
  const db = env.DB;
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = excluded.status,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
         current_period_end = excluded.current_period_end`
    )
    .bind(
      params.userId,
      params.tier,
      params.status,
      params.stripeCustomerId ?? null,
      params.stripeSubscriptionId ?? null,
      params.currentPeriodEnd ?? null
    )
    .run();
}
