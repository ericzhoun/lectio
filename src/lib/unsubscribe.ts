// Leaving is as quiet as arriving. This is called from both a GET (a footer
// link) and a POST (Gmail/Apple Mail's one-click unsubscribe header), and it
// must do the same thing either way - and answer the page the same way too,
// so the route cannot be used to probe which addresses we hold.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { verifyMailToken } from './mailToken';
import { ensureSubscriberTable, setStatus } from './subscribers';

export async function unsubscribeFromRequest(url: URL): Promise<boolean> {
  const email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  const token = url.searchParams.get('t') ?? '';
  if (!email || !token) return false;

  const secret = env.MAIL_TOKEN_SECRET as string | undefined;
  if (!secret) {
    console.error('daily-invitation: MAIL_TOKEN_SECRET is not set; cannot unsubscribe');
    return false;
  }
  if (!(await verifyMailToken(email, token, secret))) {
    // The page still renders success (anti-enumeration), so this is the only
    // signal an operator gets. Never log the token, secret, or full address -
    // this is reachable by anyone with a captured or guessed link.
    console.error(
      'daily-invitation: unsubscribe token did not verify (secret drift between Workers?)'
    );
    return false;
  }

  const db = env.DB as D1Database;
  await ensureSubscriberTable(db);
  await setStatus(db, email, 'unsubscribed');
  return true;
}
