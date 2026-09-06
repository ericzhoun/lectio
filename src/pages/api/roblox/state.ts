// src/pages/api/roblox/state.ts
// Usage state for a Roblox reader (called by the game server on join).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  buildRobloxState,
  getRobloxPlayer,
  guardRobloxRequest,
  json,
  readJsonBody,
  robloxPlayerKey,
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
  const player = await getRobloxPlayer(env.DB, playerKey);
  const state = await buildRobloxState(env.DB, playerKey, player.registered);
  return json({ ok: true, state });
};
