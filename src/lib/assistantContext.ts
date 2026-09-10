// One place where a request becomes a ToolContext.
//
// Three different subject keys meet here and must never be confused:
//   - `visitorKey`   the chat-message quota subject, from the `chat_anon` cookie
//                    (or `u:<userId>` when signed in). Also the card binding.
//   - `usageSubject` the reading-quota subject, keyed into `usage_daily`, from
//                    the site's own `user_id` cookie (or the user id).
//   - `userId`       the account identity, from the verified `session` cookie.
//
// Both /api/assistant/chat and /api/assistant/act build their context from
// here, so the two can never drift. Where they legitimately differ - which
// cookies each is allowed to issue - the difference is an explicit option
// rather than duplicated code.
import { env } from 'cloudflare:workers';
import type { Lang } from './reading';
import type { Tier } from './entitlements';
import { resolveTier } from './entitlements';
import { verifySessionToken } from './session';
import type { ToolContext } from './assistantTools';

export const ANON_COOKIE = 'chat_anon';
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** The site's own visitor id, minted by src/pages/index.astro on the first draw. */
export const USER_ID_COOKIE = 'user_id';

/** Only the `a:` namespace is a visitor's to claim; `u:` keys belong to accounts. */
const ANON_KEY_RE = /^a:[A-Za-z0-9-]{1,64}$/;

/** The subset of Astro's cookie API this module needs. */
export interface ToolContextCookies {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

export interface BuildToolContextOptions {
  request: Request;
  cookies: ToolContextCookies;
  /**
   * Issue a fresh `chat_anon` cookie when the request carries none.
   *
   * The chat endpoint does (page renders never set cookies, so the first
   * message is where an anonymous visitor gets their key). The confirm
   * endpoint deliberately does not: a confirm without a usable `chat_anon`
   * can never match a card's binding, and minting a key there would only
   * paper over that. It leaves `visitorKey` empty and the caller rejects.
   */
  issueVisitorCookie: boolean;
  /**
   * Issue a fresh `user_id` cookie when the request carries none.
   *
   * Only the confirm endpoint does, because only it actually spends reading
   * quota. Without this a guest who has never drawn on the page would be
   * billed against their chat key - a bucket the site itself never reads -
   * and would then get a second full allowance the moment the page minted
   * them a real `user_id`.
   */
  issueUsageCookie: boolean;
}

/** A cookie value only counts when it is a non-empty string after trimming. */
function cookieValue(cookies: ToolContextCookies, name: string): string {
  return (cookies.get(name)?.value ?? '').trim();
}

export async function buildToolContext(opts: BuildToolContextOptions): Promise<ToolContext> {
  const { cookies } = opts;

  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

  const registered = Boolean(userId);
  const tier: Tier = userId ? await resolveTier(userId) : 'free';

  let visitorKey: string;
  if (userId) {
    visitorKey = `u:${userId}`;
  } else {
    // The cookie is httpOnly and self-issued, but a visitor can still present
    // whatever they like in their own browser; the prefix check keeps a forged
    // cookie out of a registered user's `u:` bucket.
    const existing = cookieValue(cookies, ANON_COOKIE);
    if (ANON_KEY_RE.test(existing)) {
      visitorKey = existing;
    } else if (opts.issueVisitorCookie) {
      visitorKey = `a:${crypto.randomUUID()}`;
      cookies.set(ANON_COOKIE, visitorKey, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: ANON_COOKIE_MAX_AGE,
      });
    } else {
      visitorKey = '';
    }
  }

  // Note the `||`, not `??`: a present-but-empty `user_id` cookie must not
  // collapse every such visitor into one shared '' quota bucket, which would
  // both deny readings someone is owed and grant readings they are not.
  let usageSubject = userId || cookieValue(cookies, USER_ID_COOKIE);
  if (!usageSubject && opts.issueUsageCookie) {
    usageSubject = crypto.randomUUID();
    // Exactly the options src/pages/index.astro uses when it mints this
    // cookie, so the page and the assistant share one visitor id.
    cookies.set(USER_ID_COOKIE, usageSubject, { path: '/', httpOnly: true });
  }
  // Last resort: a visitor with no site id at all has never drawn, so the
  // visitor key looks up nothing - the truthful answer, not a stale one.
  if (!usageSubject) usageSubject = visitorKey;

  const lang: Lang = cookies.get('lang')?.value === 'zh' ? 'zh' : 'en';

  return {
    userId,
    registered,
    tier,
    lang,
    visitorKey,
    usageSubject,
    db: env.DB,
    origin: new URL(opts.request.url).origin,
  };
}
