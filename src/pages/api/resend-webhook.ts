// Resend tells us when an address is dead or when someone marked us as spam.
// Acting on both automatically is what lets the list stay single opt-in.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { ensureSubscriberTable, setStatus } from '../../lib/subscribers';

const ENCODER = new TextEncoder();

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Svix signing, as Resend documents it (resend.com/docs/dashboard/webhooks/
 * verify-webhooks-requests, which defers to docs.svix.com for the details):
 * sign `${svix-id}.${svix-timestamp}.${rawBody}` with the whsec_ secret
 * (base64 after the prefix) and compare against any `v1,<base64>` entry in
 * the space-separated svix-signature header.
 */
async function verifyWebhook(
  secret: string,
  headers: Headers,
  rawBody: string
): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject anything older than five minutes so a captured request cannot be
  // replayed to suppress an address later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(`${id}.${timestamp}.${rawBody}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header carries a space-separated list; any version-1 entry may match.
  return signatureHeader
    .split(' ')
    .some((entry) => entry.startsWith('v1,') && entry.slice(3) === expected);
}

interface ResendEvent {
  type?: string;
  data?: { to?: string[]; bounce?: { type?: string } };
}

export const POST: APIRoute = async ({ request }) => {
  const secret = env.RESEND_WEBHOOK_SECRET as string | undefined;
  if (!secret) {
    console.error('daily-invitation: RESEND_WEBHOOK_SECRET is not set');
    return new Response('not configured', { status: 500 });
  }

  const rawBody = await request.text();
  if (!(await verifyWebhook(secret, request.headers, rawBody))) {
    return new Response('bad signature', { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  // Only a hard bounce means the address is dead. Resend's docs label the
  // soft-bounce value "Temporary" (some sources say "Transient"); either way
  // we only positively match "Permanent" so a soft bounce never suppresses.
  const hardBounce = event.type === 'email.bounced' && event.data?.bounce?.type === 'Permanent';
  const complaint = event.type === 'email.complained';
  if (!hardBounce && !complaint) return new Response('ok', { status: 200 });

  const db = env.DB as D1Database;
  await ensureSubscriberTable(db);
  for (const address of event.data?.to ?? []) {
    await setStatus(db, address, 'bounced');
  }

  return new Response('ok', { status: 200 });
};
