// Resend tells us when an address is dead or when someone marked us as spam.
// Acting on both automatically is what lets the list stay single opt-in.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { ensureSubscriberTable, setStatus } from '../../lib/subscribers';
import { constantTimeEqual } from '../../lib/constantTimeEqual';

const ENCODER = new TextEncoder();

/** Returns null on malformed base64 rather than throwing, so a bad secret or
 * a bad signature entry can be handled as "does not verify" instead of
 * crashing the request with an unhandled exception. */
// Returns a plain ArrayBuffer rather than a Uint8Array view: the DOM lib's
// BufferSource / ArrayBufferView types require the backing buffer to be
// exactly ArrayBuffer (not the wider ArrayBufferLike a typed array carries),
// so importKey below needs the buffer itself, not a view over it.
function fromBase64(b64: string): ArrayBuffer | null {
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

/**
 * Decodes RESEND_WEBHOOK_SECRET's whsec_ prefix into an HMAC key. Returns
 * null if the configured secret is not valid base64 - a config typo should
 * surface as a clear "not configured correctly" 500, not an unhandled
 * exception that crashes the request.
 */
async function importSecretKey(secret: string): Promise<CryptoKey | null> {
  const keyBytes = fromBase64(secret.replace(/^whsec_/, ''));
  if (!keyBytes) return null;
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

/**
 * Svix signing, as Resend documents it (resend.com/docs/dashboard/webhooks/
 * verify-webhooks-requests, which defers to docs.svix.com for the details):
 * sign `${svix-id}.${svix-timestamp}.${rawBody}` with the whsec_ secret
 * (base64 after the prefix) and compare against any `v1,<base64>` entry in
 * the space-separated svix-signature header.
 */
async function verifyWebhook(
  key: CryptoKey,
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

  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(`${id}.${timestamp}.${rawBody}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header carries a space-separated list; any version-1 entry may
  // match. A malformed entry (not valid base64) just fails to match rather
  // than throwing - Resend controls this header, but a proxy or Resend bug
  // truncating it should not turn into a 500.
  return signatureHeader
    .split(' ')
    .some((entry) => entry.startsWith('v1,') && constantTimeEqual(entry.slice(3), expected));
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

  const key = await importSecretKey(secret);
  if (!key) {
    console.error('daily-invitation: RESEND_WEBHOOK_SECRET is not valid base64');
    return new Response('not configured correctly', { status: 500 });
  }

  const rawBody = await request.text();
  if (!(await verifyWebhook(key, request.headers, rawBody))) {
    // Never log the signature itself - only that verification failed.
    console.error('daily-invitation: webhook signature did not verify');
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
