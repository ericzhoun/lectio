// Signed cookie for the anonymous "draw now, register to reveal" flow.
//
// When an unregistered visitor receives a multi-verse layout, the draw is
// stored in an HMAC-signed cookie (same secret as the session cookie). The
// visitor sees the verses but not the reflection; after they register or log
// in, the home page verifies the cookie, generates the question-based
// reflection, and clears the cookie. The signature prevents tampering with
// the drawn verses.
import { toBase64Url, fromBase64Url, hmacKey } from './session';

export const PENDING_DRAW_COOKIE = 'pending_draw';
/** Pending draws expire after 7 days. */
export const PENDING_DRAW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Keep the cookie payload small; questions longer than this are truncated. */
export const PENDING_QUESTION_MAX_CHARS = 300;
/** Largest gated layout: Deep Lectio (10 verses). */
export const PENDING_DRAW_MAX_ITEMS = 10;

export type PendingDrawSpread = '3card' | 'celtic_cross';

export interface PendingDraw {
  v: 1;
  spread: PendingDrawSpread;
  question: string;
  /** Drawn verse identities (English refs are unique keys). */
  verses: string[];
  /** Issue time (ms since epoch), used for expiry. */
  ts: number;
}

export function truncateQuestion(question: string): string {
  return question.trim().slice(0, PENDING_QUESTION_MAX_CHARS);
}

export async function createPendingDrawToken(
  draw: PendingDraw,
  secret: string
): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is required');
  const payload = { ...draw, question: truncateQuestion(draw.question) };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encoded)
  );
  return `${encoded}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyPendingDrawToken(
  token: string | undefined | null,
  secret: string
): Promise<PendingDraw | null> {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sigB64] = parts;

  const key = await hmacKey(secret);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64) as BufferSource,
      new TextEncoder().encode(encoded)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return null;
  }
  if (!isPendingDraw(data)) return null;
  if (Date.now() - data.ts > PENDING_DRAW_TTL_MS) return null;
  return data;
}

function isValidSpread(v: unknown): v is PendingDrawSpread {
  return v === '3card' || v === 'celtic_cross';
}

function isPendingDraw(value: unknown): value is PendingDraw {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  if (d.v !== 1 || !isValidSpread(d.spread)) return false;
  if (typeof d.question !== 'string' || d.question.length > PENDING_QUESTION_MAX_CHARS) return false;
  if (typeof d.ts !== 'number' || !Number.isFinite(d.ts)) return false;

  const itemCountOk = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= PENDING_DRAW_MAX_ITEMS;

  if (!Array.isArray(d.verses) || !itemCountOk(d.verses.length)) return false;
  return d.verses.every((r) => typeof r === 'string' && r.length > 0 && r.length <= 64);
}
