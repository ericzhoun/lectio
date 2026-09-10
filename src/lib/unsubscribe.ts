// Leaving is as quiet as arriving. This is called from both a GET (a footer
// link) and a POST (Gmail/Apple Mail's one-click unsubscribe header), and it
// must do the same thing either way - and answer the page the same way too,
// so the route cannot be used to probe which addresses we hold.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { signMailToken, verifyMailToken } from './mailToken';
import { ensureSubscriberTable, getSubscriber, setStatus } from './subscribers';
import { sendBatch } from './resend';

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

const LINK_COPY = {
  en: {
    subject: 'Stop the Daily Invitation',
    line: 'Someone asked us to stop sending the Daily Invitation to this address. If that was you, confirm with the link below. If it was not, ignore this email and nothing changes.',
    action: 'Confirm unsubscribe',
  },
  zh: {
    subject: '停止接收每日邀请',
    line: '有人请求停止向这个邮箱发送每日邀请。如果是你，请用下面的链接确认；如果不是，忽略这封邮件即可，什么都不会改变。',
    action: '确认退订',
  },
} as const;

/**
 * Mail an unsubscribe link to an address whose owner has not been proved - the
 * assistant's unsubscribe tool talking about someone else's inbox. The link is
 * the same one the newsletter footer carries, so only the address itself can
 * act on the request.
 *
 * A missing or already-inactive subscriber is a silent no-op: doing anything
 * visible would confirm to a stranger that an address is on the list.
 */
export async function sendUnsubscribeLink(
  email: string,
  db: D1Database,
  origin: string
): Promise<void> {
  const address = email.trim().toLowerCase();
  await ensureSubscriberTable(db);
  const subscriber = await getSubscriber(db, address);
  if (!subscriber || subscriber.status !== 'active') return;

  const secret = env.MAIL_TOKEN_SECRET as string | undefined;
  const apiKey = env.RESEND_API_KEY as string | undefined;
  if (!secret || !apiKey) {
    console.error('daily-invitation: MAIL_TOKEN_SECRET or RESEND_API_KEY missing; no link sent');
    return;
  }

  const token = await signMailToken(address, secret);
  const link =
    `${origin.replace(/\/$/, '')}/unsubscribe?e=${encodeURIComponent(address)}` +
    `&t=${encodeURIComponent(token)}${subscriber.lang === 'zh' ? '&lang=zh' : ''}`;
  const copy = LINK_COPY[subscriber.lang === 'zh' ? 'zh' : 'en'];

  await sendBatch(
    [
      {
        to: address,
        subject: copy.subject,
        html: `<p>${copy.line}</p><p><a href="${link}">${copy.action}</a></p>`,
        text: `${copy.line}\n\n${copy.action}: ${link}\n`,
        unsubscribeUrl: link,
      },
    ],
    apiKey
  );
}
