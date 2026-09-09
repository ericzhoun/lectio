// The Daily Invitation as it arrives in an inbox: one title, one passage, one
// link. Pure - everything it needs is already bundled, so a send never depends
// on a network call other than the one that delivers it.
import { focusReference, getLectionaryDay, hasLectionaryDay } from './lectionary';
import { resolvePassage } from './passage';
import type { Lang } from './reading';

export const SITE_ORIGIN = 'https://enjoyhim.org';

/** Long enough to sit with, short enough that no one scrolls an inbox. */
const MAX_PASSAGE_CHARS = 900;

export function unsubscribeUrl(email: string, token: string): string {
  return `${SITE_ORIGIN}/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(text: string, lang: Lang): { body: string; truncated: boolean } {
  if (text.length <= MAX_PASSAGE_CHARS) return { body: text, truncated: false };
  const cut = text.slice(0, MAX_PASSAGE_CHARS);
  // Prefer to end on a sentence so the excerpt does not stop mid-breath.
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'));
  const body = stop > MAX_PASSAGE_CHARS / 2 ? cut.slice(0, stop + 1) : cut;
  return { body: lang === 'zh' ? `${body}……` : `${body}...`, truncated: true };
}

const COPY = {
  en: {
    greeting: 'One verse with your morning.',
    readOn: 'Read the rest',
    sit: 'Sit with it today',
    unsubscribe: 'Unsubscribe',
    note: 'At most one email a day.',
  },
  zh: {
    greeting: '清晨的一句话。',
    readOn: '读完整段',
    sit: '今天与它同坐',
    unsubscribe: '退订',
    note: '每天最多一封。',
  },
} as const;

export function renderDailyEmail(
  dayKey: string,
  lang: Lang,
  unsubscribeLink: string
): { subject: string; html: string; text: string } | null {
  if (!hasLectionaryDay(dayKey)) return null;

  const day = getLectionaryDay(dayKey);
  const passage = resolvePassage(focusReference(day), lang);
  // No passage means no email. A broken send is worse than a missed one.
  if (!passage) return null;

  const copy = COPY[lang];
  const title = day.title[lang];
  const { body, truncated } = truncate(passage.text, lang);
  const todayUrl = `${SITE_ORIGIN}/today?lang=${lang}`;

  const subject = `${title} - ${passage.ref}`;

  const text = [
    copy.greeting,
    '',
    title,
    passage.ref,
    '',
    body,
    '',
    truncated ? `${copy.readOn}: ${todayUrl}` : `${copy.sit}: ${todayUrl}`,
    '',
    copy.note,
    `${copy.unsubscribe}: ${unsubscribeLink}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:32px 16px;background:#faf8f4;color:#2b2622;font:16px/1.7 Georgia,'Songti SC',serif;">
  <div style="max-width:34em;margin:0 auto;">
    <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7f72;">${escapeHtml(copy.greeting)}</p>
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:normal;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#8a7f72;">${escapeHtml(passage.ref)}</p>
    <div style="margin:0 0 28px;white-space:pre-wrap;">${escapeHtml(body)}</div>
    <p style="margin:0 0 40px;"><a href="${todayUrl}" style="color:#7a5c3e;">${escapeHtml(truncated ? copy.readOn : copy.sit)}</a></p>
    <hr style="border:none;border-top:1px solid #e5ded3;margin:0 0 16px;" />
    <p style="margin:0;font-size:12px;color:#a2988c;">
      ${escapeHtml(copy.note)}
      <a href="${escapeHtml(unsubscribeLink)}" style="color:#a2988c;">${escapeHtml(copy.unsubscribe)}</a>
    </p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
