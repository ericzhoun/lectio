import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';

// One-time multi-card trial credits granted to registered accounts
// ("new account perks"). Anonymous cookie visitors never get credits.
export type CreditSpread = '3card' | 'celtic_cross';
export type CreditBalance = Record<CreditSpread, number>;

/** Welcome credits granted once per registered account. */
export const WELCOME_CREDITS: CreditBalance = {
  '3card': 3,
  celtic_cross: 1,
};

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS welcome_credits (user_id TEXT PRIMARY KEY, credit_3card INTEGER NOT NULL DEFAULT 0, credit_celtic INTEGER NOT NULL DEFAULT 0, granted_at DATETIME DEFAULT CURRENT_TIMESTAMP)';

const initializedDbs = new WeakSet<object>();

export async function ensureCreditsTable(db: D1Database = env.DB): Promise<void> {
  if (initializedDbs.has(db as object)) return;
  await db.exec(CREATE_TABLE_SQL);
  initializedDbs.add(db as object);
}

async function ensureTable(db: D1Database): Promise<void> {
  await ensureCreditsTable(db);
}

function toBalance(row: { credit_3card?: number; credit_celtic?: number } | null): CreditBalance {
  return {
    '3card': row?.credit_3card ?? 0,
    celtic_cross: row?.credit_celtic ?? 0,
  };
}

/**
 * Grant the one-time welcome credits if (and only if) the account has none yet.
 * Idempotent: re-running never tops an account back up.
 */
export async function grantWelcomeCredits(userId: string, db: D1Database = env.DB): Promise<void> {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO welcome_credits (user_id, credit_3card, credit_celtic) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    )
    .bind(userId, WELCOME_CREDITS['3card'], WELCOME_CREDITS.celtic_cross)
    .run();
}

/** Ensure the grant exists, then return the current balance. */
export async function ensureWelcomeCredits(userId: string, db: D1Database = env.DB): Promise<CreditBalance> {
  await grantWelcomeCredits(userId, db);
  return getCreditBalance(userId, db);
}

export async function getCreditBalance(userId: string, db: D1Database = env.DB): Promise<CreditBalance> {
  await ensureTable(db);
  const row = await db
    .prepare('SELECT credit_3card, credit_celtic FROM welcome_credits WHERE user_id = ?')
    .bind(userId)
    .first<{ credit_3card: number; credit_celtic: number }>();
  return toBalance(row);
}

/** Admin dashboard action: overwrite a user's trial credit balance. */
export async function setCreditBalance(
  userId: string,
  balance: CreditBalance,
  db: D1Database = env.DB
): Promise<void> {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO welcome_credits (user_id, credit_3card, credit_celtic) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET credit_3card = excluded.credit_3card, credit_celtic = excluded.credit_celtic`
    )
    .bind(userId, Math.max(0, Math.floor(balance['3card'])), Math.max(0, Math.floor(balance.celtic_cross)))
    .run();
}

/** Spend one credit for a spread; never drops below zero. */
export async function consumeCredit(
  userId: string,
  spreadKey: CreditSpread,
  db: D1Database = env.DB
): Promise<void> {
  await ensureTable(db);
  const col = spreadKey === 'celtic_cross' ? 'credit_celtic' : 'credit_3card';
  await db
    .prepare(`UPDATE welcome_credits SET ${col} = MAX(${col} - 1, 0) WHERE user_id = ?`)
    .bind(userId)
    .run();
}
