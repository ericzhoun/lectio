// Beacon endpoint for the page script's event batches. No cookies are read
// for identity — middleware guarantees the `vid` cookie already exists.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ingestClientEvents } from '../../../lib/analytics';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const visitorId = cookies.get('vid')?.value;
  if (!visitorId) return new Response(null, { status: 204 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const db = env.DB;
  if (db) {
    try {
      await ingestClientEvents(db, visitorId, payload);
    } catch (e) {
      console.error('Error ingesting analytics events:', e);
    }
  }
  // Always 204: analytics failures must never surface to the reader.
  return new Response(null, { status: 204 });
};
