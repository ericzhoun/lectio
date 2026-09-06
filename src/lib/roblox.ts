// src/lib/roblox.ts
// Server-to-server integration for the Lectio Roblox world (src/roblox).
// The Roblox game server calls /api/roblox/* with the shared secret in the
// X-Lectio-Key header and identifies each reader by their Roblox UserId.
// Readers live in the same D1 tables as web visitors, namespaced `rb:<id>`,
// so quotas and credits share one set of semantics across both front-ends.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { ANON_DAILY_DRAWS, REGISTERED_DAILY_DRAWS } from './entitlements';
import { getCreditBalance, type CreditBalance } from './credits';
import { getTodayUsage } from './usage';
import { getChatUsage } from './chatUsage';
import { evaluateChatQuota } from './assistant';

/** Request header carrying the shared secret from the Roblox game server. */
export const ROBLOX_KEY_HEADER = 'x-lectio-key';

/** Spread key for each Roblox reading mode (world keys stay stable). */
export const SPREAD_FOR_MODE: Record<string, string> = {
  daily: 'single',
  divina: '3card',
  deep: 'celtic_cross',
};

/** Constant-time compare so a mistyped key probing is not timing-observable. */
export function keysMatch(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** True when the request carries the configured ROBLOX_API_KEY. */
export function verifyRobloxKey(headerValue: string | null | undefined): boolean {
  const expected = env.ROBLOX_API_KEY;
  if (!expected || !headerValue) return false;
  return keysMatch(headerValue, expected);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Auth gate for every /api/roblox route. Returns a Response to send, or null
 * when the request may proceed. 503 when the secret is not configured (the
 * integration is off), 401 on a wrong key.
 */
export function guardRobloxRequest(request: Request): Response | null {
  if (!env.ROBLOX_API_KEY) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }
  if (!verifyRobloxKey(request.headers.get(ROBLOX_KEY_HEADER))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  return null;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Roblox UserIds are positive integers; anything else is a forged key. */
export function validPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,12}$/.test(value);
}

/** Strip control characters and cap length for a display name. */
export function sanitizeDisplayName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  return raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 40);
}

export function robloxPlayerKey(robloxUserId: string): string {
  return `rb:${robloxUserId}`;
}

// ---- Roblox player registry ------------------------------------------------
// In-world registration is a free account without email: it unlocks the
// registered-free tier (6 readings/day + welcome trial credits), the same
// perks the website grants, keyed to the Roblox identity.

const CREATE_PLAYERS_SQL = `CREATE TABLE IF NOT EXISTS roblox_players (
  user_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  registered INTEGER NOT NULL DEFAULT 0,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

const initializedByDb = new WeakSet<object>();

async function ensurePlayersTable(db: D1Database): Promise<void> {
  if (initializedByDb.has(db as unknown as object)) return;
  await db.exec(CREATE_PLAYERS_SQL.replace(/\n\s*/g, ' '));
  initializedByDb.add(db as unknown as object);
}

export interface RobloxPlayer {
  registered: boolean;
  displayName: string;
}

export async function getRobloxPlayer(db: D1Database, playerKey: string): Promise<RobloxPlayer> {
  await ensurePlayersTable(db);
  const row = await db
    .prepare('SELECT display_name, registered FROM roblox_players WHERE user_key = ?')
    .bind(playerKey)
    .first<{ display_name: string; registered: number }>();
  return {
    registered: (row?.registered ?? 0) === 1,
    displayName: row?.display_name ?? '',
  };
}

/** Mark the player registered; idempotent, keeps the original registered_at. */
export async function registerRobloxPlayer(
  db: D1Database,
  playerKey: string,
  displayName: string
): Promise<void> {
  await ensurePlayersTable(db);
  await db
    .prepare(
      `INSERT INTO roblox_players (user_key, display_name, registered) VALUES (?, ?, 1)
       ON CONFLICT(user_key) DO UPDATE SET registered = 1, display_name = excluded.display_name`
    )
    .bind(playerKey, displayName)
    .run();
}

// ---- Entitlements -----------------------------------------------------------
// Roblox readers are all tier 'free' (no paid plans in-world). The multi-verse
// layouts are registered gifts: the world has no gated "read now, register to
// reveal" flow, so unlike the website an anonymous reader is told to register
// up front instead of receiving gated verses.

export type RobloxEntitlementResult =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'no_credits' | 'locked' };

export interface RobloxEntitlementInput {
  registered: boolean;
  todayCount: number;
  spreadKey: string;
  credits: CreditBalance;
}

export function dailyLimitFor(registered: boolean): number {
  return registered ? REGISTERED_DAILY_DRAWS : ANON_DAILY_DRAWS;
}

export function evaluateRobloxEntitlement({
  registered,
  todayCount,
  spreadKey,
  credits,
}: RobloxEntitlementInput): RobloxEntitlementResult {
  if (spreadKey === 'single') {
    return todayCount >= dailyLimitFor(registered) ? { ok: false, reason: 'quota' } : { ok: true };
  }
  if (!registered) return { ok: false, reason: 'locked' };
  return (credits[spreadKey as keyof CreditBalance] ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'no_credits' };
}

/** Client-facing error key, matching the LocalScript's L tables. */
export function errorKeyForReason(reason: 'quota' | 'no_credits' | 'locked', spreadKey: string): string {
  if (reason === 'quota') return 'limitMsg';
  return spreadKey === 'celtic_cross' ? 'deepMsg' : 'divinaMsg';
}

export interface RobloxState {
  registered: boolean;
  used: number;
  limit: number;
  divina: number;
  deep: number;
  chatRemaining: number;
}

/** Assemble the state payload the world's UI renders (usage + credits + chat). */
export async function buildRobloxState(
  db: D1Database,
  playerKey: string,
  registered: boolean
): Promise<RobloxState> {
  const [used, credits, chatUsed] = await Promise.all([
    getTodayUsage(playerKey),
    getCreditBalance(playerKey, db),
    getChatUsage(playerKey, db),
  ]);
  const chatQuota = evaluateChatQuota({ registered, tier: 'free' }, chatUsed);
  return {
    registered,
    used,
    limit: dailyLimitFor(registered),
    divina: registered ? credits['3card'] : 0,
    deep: registered ? credits.celtic_cross : 0,
    chatRemaining: chatQuota.remaining,
  };
}
