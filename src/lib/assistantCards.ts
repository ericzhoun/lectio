// A confirm card is a proposal the model made and the visitor has not yet
// accepted. The token is the whole authorization: it names the tool and the
// exact normalized args, binds them to the visitor who was shown the card, and
// expires. Nothing the model says at confirm time is trusted - only this.
import { signJsonToken, readJsonToken } from './session';

/** A proposal the visitor has ten minutes to accept. */
export const CARD_TTL_MS = 10 * 60 * 1000;

export interface CardPayload {
  v: 1;
  tool: string;
  args: Record<string, unknown>;
  /** The visitor the card was issued to: `u:<userId>` or `a:<uuid>`. */
  visitorKey: string;
  ts: number;
}

export async function signCardToken(
  payload: Omit<CardPayload, 'v' | 'ts'>,
  secret: string
): Promise<string> {
  return signJsonToken({ v: 1, ...payload, ts: Date.now() } satisfies CardPayload, secret);
}

/**
 * The card's own claims: signature, shape and expiry, with the visitor binding
 * deliberately left unchecked. Authorizes nothing on its own - a caller that
 * acts on the payload must still confirm `visitorKey`. It exists so the confirm
 * endpoint can tell "this card was issued to a signed-in visitor who is no
 * longer signed in" (answer: sign in again) from "this card belongs to somebody
 * else" (answer: nothing at all).
 */
export async function readCardToken(
  token: string | undefined | null,
  secret: string
): Promise<CardPayload | null> {
  const data = await readJsonToken(token, secret);
  if (!isCardPayload(data)) return null;
  if (Date.now() - data.ts > CARD_TTL_MS) return null;
  return data;
}

export async function verifyCardToken(
  token: string | undefined | null,
  visitorKey: string,
  secret: string
): Promise<CardPayload | null> {
  const data = await readCardToken(token, secret);
  if (!data || data.visitorKey !== visitorKey) return null;
  return data;
}

function isCardPayload(value: unknown): value is CardPayload {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    d.v === 1 &&
    typeof d.tool === 'string' &&
    d.tool.length > 0 &&
    typeof d.visitorKey === 'string' &&
    d.visitorKey.length > 0 &&
    typeof d.ts === 'number' &&
    Number.isFinite(d.ts) &&
    typeof d.args === 'object' &&
    d.args !== null &&
    !Array.isArray(d.args)
  );
}
