// One hourly tick of the Daily Invitation. Every dependency is injected so the
// whole send can be exercised in a unit test with an in-memory database and a
// fake fetch - no Worker runtime required.
import type { D1Database } from '@cloudflare/workers-types';
import { renderDailyEmail, unsubscribeUrl } from './dailyEmail';
import { signMailToken } from './mailToken';
import { dueNow } from './mailSchedule';
import { sendBatch, type OutgoingMail } from './resend';
import { activeSubscribers, ensureSubscriberTable, markSent } from './subscribers';

export interface SendDeps {
  db: D1Database;
  now: Date;
  apiKey: string;
  tokenSecret: string;
  fetchImpl?: typeof fetch;
}

export async function sendDailyInvitations(
  deps: SendDeps
): Promise<{ sent: number; skipped: number }> {
  await ensureSubscriberTable(deps.db);

  const due = dueNow(deps.now, await activeSubscribers(deps.db));
  if (due.length === 0) return { sent: 0, skipped: 0 };

  const messages: OutgoingMail[] = [];
  // Group by local day so a tick that spans two dates still marks each reader
  // with the day that was actually theirs, not the tick's own UTC date.
  const dayFor = new Map<string, string>();
  let skipped = 0;

  for (const subscriber of due) {
    const token = await signMailToken(subscriber.email, deps.tokenSecret);
    const link = unsubscribeUrl(subscriber.email, token, subscriber.lang);
    const rendered = renderDailyEmail(subscriber.localDay, subscriber.lang, link, subscriber.tz);
    if (!rendered) {
      // No passage for this day: a missed morning beats a broken one.
      console.error(
        'daily-invitation: no readable passage for',
        subscriber.localDay,
        subscriber.lang
      );
      skipped++;
      continue;
    }
    messages.push({
      to: subscriber.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: link,
    });
    dayFor.set(subscriber.email, subscriber.localDay);
  }

  if (messages.length === 0) return { sent: 0, skipped };

  const { delivered, failed } = await sendBatch(messages, deps.apiKey, deps.fetchImpl);
  if (failed.length > 0) {
    // Deliberately not marked: dueNow's send window (06:00-09:00 local)
    // means a later tick within this same morning tries them again.
    console.error('daily-invitation: failed to deliver to', failed.length, 'readers');
  }

  const byDay = new Map<string, string[]>();
  for (const email of delivered) {
    const day = dayFor.get(email);
    if (!day) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), email]);
  }
  for (const [day, emails] of byDay) {
    await markSent(deps.db, emails, day);
  }

  return { sent: delivered.length, skipped };
}
