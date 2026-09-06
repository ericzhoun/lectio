// src/pages/api/roblox/library.ts
// The full 148-verse deck for the world's Verse Library wall, in canonical
// book order with both languages and themes.
import type { APIRoute } from 'astro';
import { getLibraryVerses } from '../../../lib/scripture';
import { guardRobloxRequest, json } from '../../../lib/roblox';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const denied = guardRobloxRequest(request);
  if (denied) return denied;

  return json({ ok: true, verses: getLibraryVerses() });
};
