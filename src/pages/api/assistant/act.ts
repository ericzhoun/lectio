// Redeem one confirm card. The card is the authorization; the session is the
// identity. Nothing the client sends besides the token is trusted - not the
// args, not who they claim to be.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readCardToken } from '../../../lib/assistantCards';
import { getTool, validateArgs, type ToolContext } from '../../../lib/assistantTools';
import { verifySessionToken } from '../../../lib/session';
import { resolveTier } from '../../../lib/entitlements';
import { LAST_READING_COOKIE, createLastReadingToken } from '../../../lib/lastReading';
import { saveReadingRendering } from '../../../lib/db';

export const prerender = false;

const ANON_COOKIE = 'chat_anon';
const LAST_READING_MAX_AGE = 60 * 60 * 24 * 7;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** The shape start_reading returns when the draw actually produced a reading. */
interface ReadingResult {
  kind: 'reading';
  readingId: string;
  spreadKey: string;
  question: string;
  verses: { refEn: string; text: string; tags: string[] }[];
  summary: string;
  followUps: string[];
}

function isReadingResult(value: unknown): value is ReadingResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    r.kind === 'reading' &&
    typeof r.readingId === 'string' &&
    typeof r.spreadKey === 'string' &&
    Array.isArray(r.verses) &&
    r.verses.length > 0 &&
    // Without every English ref the cookie could not be rebuilt anyway, and
    // verifyLastReadingToken would reject it on the way back in.
    r.verses.every(
      (v) => typeof (v as { refEn?: unknown })?.refEn === 'string' && (v as { refEn: string }).refEn
    )
  );
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  // The site-wide origin guard (src/lib/originCheck.ts) mirrors Astro's, which
  // deliberately lets non-form content types through. This route performs
  // writes on the visitor's behalf, so it checks Origin itself rather than
  // relying on that.
  if (request.headers.get('origin') !== url.origin) {
    return json({ error: 'forbidden_origin' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
  const anonKey = cookies.get(ANON_COOKIE)?.value ?? '';
  // Same prefix guard the chat endpoint applies: chat_anon is self-issued and
  // httpOnly, but a visitor can still present whatever they like in their own
  // browser, and only the `a:` namespace is theirs to claim. Without this, a
  // signed-out request carrying chat_anon=u:<someone> would be treated as that
  // someone for card-binding purposes.
  const visitorKey = userId ? `u:${userId}` : /^a:[A-Za-z0-9-]{1,64}$/.test(anonKey) ? anonKey : '';

  // Signature, shape and expiry only - the visitor binding is checked below,
  // after the tool is known, so a card whose session has lapsed can be told
  // apart from one that was never the caller's.
  const card = await readCardToken(
    typeof body.token === 'string' ? body.token : null,
    env.SESSION_SECRET
  );
  // Expired, forged or tampered - all the same answer.
  if (!card) return json({ error: 'invalid_card' }, 400);

  const tool = getTool(card.tool);
  // A read tool is never confirmed - the chat loop runs those inline - so a
  // card naming one is not a card this endpoint ever issued.
  if (!tool || tool.kind !== 'write') return json({ error: 'invalid_card' }, 400);
  // A user-only tool's card is always issued to a `u:` key, so a signed-out
  // caller can never satisfy the binding below. Say why rather than pretending
  // the card is bad.
  if (tool.auth === 'user' && !userId) return json({ error: 'sign_in_required' }, 401);
  // The binding: this card was issued to this visitor, and nobody else runs it.
  // An empty visitorKey (signed out, no usable chat_anon cookie) matches
  // nothing, since a card is never signed without one.
  if (!visitorKey || card.visitorKey !== visitorKey) return json({ error: 'invalid_card' }, 400);

  const lang: 'zh' | 'en' = cookies.get('lang')?.value === 'zh' ? 'zh' : 'en';
  const ctx: ToolContext = {
    userId,
    registered: Boolean(userId),
    tier: userId ? await resolveTier(userId) : 'free',
    lang,
    visitorKey,
    // Same reading-quota subject the chat endpoint builds: user id, else the
    // site's own user_id cookie, else the visitor key. Anything else bills a
    // draw to a bucket the site never reads.
    usageSubject: userId ?? cookies.get('user_id')?.value ?? visitorKey,
    db: env.DB,
    origin: url.origin,
  };

  // card.args, not body.args: the visitor confirmed what the card showed. They
  // were validated and normalized when the card was signed; re-running both is
  // cheap and keeps a card minted by an older deploy from reaching `run` with a
  // shape this one no longer accepts.
  const validated = validateArgs(tool, card.args);
  if (!validated.ok) return json({ error: 'invalid_card' }, 400);
  const args = tool.normalize ? tool.normalize(validated.args, ctx) : validated.args;

  let result: unknown;
  try {
    result = await tool.run(args, ctx);
  } catch (e) {
    console.error(`assistant act ${tool.name} failed:`, e);
    return json({ error: 'tool_failed' }, 500);
  }

  // A reading drawn from the widget has to become the reading the site shows,
  // or "Open the full reading" lands on whatever was drawn before it. Same two
  // steps as rememberReading in src/pages/index.astro: the signed cookie
  // carries the reading's identity, and the per-language rendering is cached
  // so a reload or language switch never costs another generation.
  if (tool.name === 'start_reading' && isReadingResult(result)) {
    try {
      const token = await createLastReadingToken(
        {
          v: 1,
          id: result.readingId,
          spread: result.spreadKey,
          question: result.question ?? '',
          verses: result.verses.map((v) => v.refEn),
          ts: Date.now(),
        },
        env.SESSION_SECRET
      );
      cookies.set(LAST_READING_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: LAST_READING_MAX_AGE,
      });
      await saveReadingRendering(result.readingId, lang, {
        summary: result.summary,
        cards: result.verses.map((v) => ({ text: v.text ?? '', tags: v.tags ?? [] })),
        followUps: result.followUps,
      });
    } catch (e) {
      // The reading was drawn and charged; failing to remember it costs the
      // "open the full reading" link, not the reading.
      console.error('assistant act could not remember the reading:', e);
    }
  }

  return json({ ok: true, tool: tool.name, result }, 200);
};
