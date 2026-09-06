// src/pages/api/roblox/register.ts
// In-world free registration: marks the Roblox player registered and grants
// the one-time welcome credits (idempotent), unlocking the registered tier.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ensureWelcomeCredits } from '../../../lib/credits';
import {
  buildRobloxState,
  getRobloxPlayer,
  guardRobloxRequest,
  json,
  readJsonBody,
  registerRobloxPlayer,
  robloxPlayerKey,
  sanitizeDisplayName,
  validPlayerId,
} from '../../../lib/roblox';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const denied = guardRobloxRequest(request);
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body || !validPlayerId(body.playerId)) {
    return json({ ok: false, error: 'invalid_player' }, 400);
  }

  const playerKey = robloxPlayerKey(body.playerId);
  const displayName = sanitizeDisplayName(body.displayName);
  await registerRobloxPlayer(env.DB, playerKey, displayName);
  // Idempotent: re-registering never tops the credits back up.
  await ensureWelcomeCredits(playerKey, env.DB);
  const player = await getRobloxPlayer(env.DB, playerKey);
  const state = await buildRobloxState(env.DB, playerKey, player.registered);
  return json({ ok: true, state });
};
