# Daily Invitation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every Daily Invitation subscriber one email at 06:00 in their own local time, containing the day's lectionary passage and a one-click unsubscribe link.

**Architecture:** A custom Astro worker entry point (`src/worker.ts`) adds a `scheduled()` handler to the existing Worker, fired hourly by a Cloudflare cron trigger. The handler reads subscribers from D1, selects those for whom it is currently 06:00 local, renders a bilingual email from the already-bundled lectionary and passage data, and sends through Resend's batch endpoint. Unsubscribe and bounce webhooks flip a `status` column so suppression needs no manual work.

**Tech Stack:** Astro 7, `@astrojs/cloudflare` 14, Cloudflare Workers (D1, cron triggers), Resend REST API, Vitest 4, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-09-daily-invitation-delivery-design.md`

## Global Constraints

- Never use the em dash character. Use a plain dash `-` in all code, comments, commit messages, and user-facing copy you write.
- Never add an agent name as commit co-author beyond the attribution block the session already uses.
- From-address is exactly `lectio@enjoyhim.org`.
- Default timezone for any subscriber without a valid one is exactly `America/Los_Angeles` (the IANA name, never the fixed-offset string `PST`).
- Send hour is 06:00 in the subscriber's local time.
- Site origin is `https://enjoyhim.org`.
- Table name is `daily_invitations`. Status values are exactly `active`, `unsubscribed`, `bounced`.
- All new library modules live in `src/lib/`, all new tests in `src/lib/__tests__/`, matching the existing layout.
- Tests run with `npx vitest run <path>`. The whole suite is `npm test`.
- Every module this plan creates must be pure enough to test without a Worker runtime: inject `fetch` and the D1 handle rather than importing `cloudflare:workers` inside library code. Only route files and `src/worker.ts` may touch `env` directly.
- Comments explain why, not what, matching the voice of the existing `src/lib` files.

---

## File Structure

**Created:**
- `src/lib/mailToken.ts` - HMAC sign/verify for unsubscribe links. No I/O.
- `src/lib/mailSchedule.ts` - pure timezone arithmetic deciding who is due.
- `src/lib/dailyEmail.ts` - pure renderer, day plus language to subject/html/text.
- `src/lib/resend.ts` - thin Resend batch client with injectable `fetch`.
- `src/lib/subscribers.ts` - the only module that knows the `daily_invitations` SQL.
- `src/worker.ts` - Astro adapter entry plus `scheduled()`. Wiring only.
- `src/pages/unsubscribe.astro` - GET and POST one-click unsubscribe page.
- `src/pages/api/resend-webhook.ts` - bounce and complaint suppression.
- `scripts/migrate-daily-invitations.mjs` - one-off additive column migration.
- `scripts/push-mail-secrets.mjs` - secret upload, mirroring the Google and Stripe scripts.
- Tests: `src/lib/__tests__/mailToken.test.ts`, `mailSchedule.test.ts`, `dailyEmail.test.ts`, `resend.test.ts`, `subscribers.test.ts`, `unsubscribe-route.test.ts`, `resend-webhook.test.ts`, `worker-scheduled.test.ts`.

**Modified:**
- `src/pages/api/daily-invitation.ts` - six-column `CREATE TABLE`, accept and validate `tz`, upsert that reactivates.
- `src/pages/index.astro:1483-1492` - send `tz` with the signup POST.
- `astro.config.mjs` - `workerEntryPoint`.
- `wrangler.jsonc` - `triggers.crons`.

**Dependency order:** Tasks 1-4 are independent leaves. Task 5 (subscribers) is independent. Task 6 depends on 1 and 5. Task 7 depends on 5. Task 8 depends on everything.

---

### Task 1: Unsubscribe token signing

**Files:**
- Create: `src/lib/mailToken.ts`
- Test: `src/lib/__tests__/mailToken.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `signMailToken(email: string, secret: string): Promise<string>` and `verifyMailToken(email: string, token: string, secret: string): Promise<boolean>`. Task 6 and Task 8 both use these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/mailToken.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signMailToken, verifyMailToken } from '../mailToken';

const SECRET = 'test-mail-secret';

describe('mail tokens', () => {
  it('verifies a token it just signed', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(true);
  });

  it('is url safe so it survives a query string', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('rejects a tampered token', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await verifyMailToken('reader@example.test', tampered, SECRET)).toBe(false);
  });

  it('rejects a token minted for a different address', async () => {
    const token = await signMailToken('someone@example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signMailToken('reader@example.test', 'other-secret');
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(false);
  });

  it('treats the address case-insensitively, as the signup route lowercases it', async () => {
    const token = await signMailToken('Reader@Example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(true);
  });

  it('rejects an empty or malformed token without throwing', async () => {
    expect(await verifyMailToken('reader@example.test', '', SECRET)).toBe(false);
    expect(await verifyMailToken('reader@example.test', 'not base64!!', SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/mailToken.test.ts`
Expected: FAIL, cannot resolve `../mailToken`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/mailToken.ts`:

```ts
// Unsubscribe links must keep working years after the email was sent, so the
// token carries no expiry: it is only a proof that this address was issued a
// link by us, not a session.
const ENCODER = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmac(email: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(email.trim().toLowerCase())
  );
  return new Uint8Array(signature);
}

export async function signMailToken(email: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(email, secret));
}

export async function verifyMailToken(
  email: string,
  token: string,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const expected = await signMailToken(email, secret);
  if (expected.length !== token.length) return false;
  // Constant time: a length-independent early return would leak the prefix.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/mailToken.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mailToken.ts src/lib/__tests__/mailToken.test.ts
git commit -m "feat: sign unsubscribe tokens for the Daily Invitation"
```

---

### Task 2: Deciding who is due

**Files:**
- Create: `src/lib/mailSchedule.ts`
- Test: `src/lib/__tests__/mailSchedule.test.ts`

**Interfaces:**
- Consumes: `Lang` from `src/lib/reading.ts`.
- Produces: `DEFAULT_TIMEZONE`, `SEND_HOUR`, `interface Subscriber { email: string; lang: Lang; tz: string; lastSent: string | null }`, `localDayAndHour(now: Date, tz: string): { day: string; hour: number }`, and `dueNow(now: Date, subscribers: Subscriber[]): Array<Subscriber & { localDay: string }>`. Task 8 consumes all of these.

This is the piece most likely to be subtly wrong, so it is isolated and tested hardest.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/mailSchedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dueNow, localDayAndHour, DEFAULT_TIMEZONE } from '../mailSchedule';
import type { Subscriber } from '../mailSchedule';

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    email: 'reader@example.test',
    lang: 'en',
    tz: 'America/Los_Angeles',
    lastSent: null,
    ...overrides,
  };
}

describe('localDayAndHour', () => {
  it('reads the wall clock in the given zone, not UTC', () => {
    // 2026-03-10T14:00Z is 06:00 in Los Angeles (PDT, UTC-8 on that date is
    // PST; March 10 2026 is after the second Sunday, so PDT, UTC-7).
    expect(localDayAndHour(new Date('2026-03-10T13:00:00Z'), 'America/Los_Angeles'))
      .toEqual({ day: '2026-03-10', hour: 6 });
  });

  it('reports hour 0 rather than 24 at local midnight', () => {
    expect(localDayAndHour(new Date('2026-03-10T07:00:00Z'), 'America/Los_Angeles').hour).toBe(0);
  });

  it('falls back to the default zone when the stored zone is nonsense', () => {
    const bogus = localDayAndHour(new Date('2026-03-10T13:00:00Z'), 'Mars/Olympus');
    const fallback = localDayAndHour(new Date('2026-03-10T13:00:00Z'), DEFAULT_TIMEZONE);
    expect(bogus).toEqual(fallback);
  });
});

describe('dueNow', () => {
  it('sends at 06:00 local and not at other hours', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    const at7 = new Date('2026-03-10T14:00:00Z');
    expect(dueNow(at6, [sub()])).toHaveLength(1);
    expect(dueNow(at7, [sub()])).toHaveLength(0);
  });

  it('picks each zone at its own 06:00 from one hourly tick', () => {
    // 22:00Z is 06:00 the next day in Shanghai and 14:00 in Los Angeles.
    const tick = new Date('2026-03-10T22:00:00Z');
    const due = dueNow(tick, [
      sub({ email: 'la@example.test', tz: 'America/Los_Angeles' }),
      sub({ email: 'sh@example.test', tz: 'Asia/Shanghai', lang: 'zh' }),
    ]);
    expect(due.map((s) => s.email)).toEqual(['sh@example.test']);
    expect(due[0].localDay).toBe('2026-03-11');
  });

  it('does not send twice in one local day', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    expect(dueNow(at6, [sub({ lastSent: '2026-03-10' })])).toHaveLength(0);
  });

  it('sends again the following local day', () => {
    const nextDay = new Date('2026-03-11T13:00:00Z');
    expect(dueNow(nextDay, [sub({ lastSent: '2026-03-10' })])).toHaveLength(1);
  });

  it('still sends exactly once on the spring-forward day', () => {
    // US DST begins 2026-03-08. 06:00 local is 13:00Z after the shift.
    const before = new Date('2026-03-08T12:00:00Z'); // 05:00 local
    const at6 = new Date('2026-03-08T13:00:00Z'); // 06:00 local
    expect(dueNow(before, [sub()])).toHaveLength(0);
    expect(dueNow(at6, [sub()])).toHaveLength(1);
  });

  it('still sends exactly once on the fall-back day', () => {
    // US DST ends 2026-11-01. 06:00 local is 14:00Z after the shift.
    const at6 = new Date('2026-11-01T14:00:00Z');
    const due = dueNow(at6, [sub()]);
    expect(due).toHaveLength(1);
    // The repeated 01:00 hour must not produce a second send later that day.
    expect(dueNow(new Date('2026-11-01T15:00:00Z'), [sub({ lastSent: due[0].localDay })]))
      .toHaveLength(0);
  });

  it('treats a subscriber with an unusable zone as Pacific rather than dropping them', () => {
    const at6 = new Date('2026-03-10T13:00:00Z');
    expect(dueNow(at6, [sub({ tz: '' })])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/mailSchedule.test.ts`
Expected: FAIL, cannot resolve `../mailSchedule`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/mailSchedule.ts`:

```ts
// Who gets the Daily Invitation on this hourly tick. Pure arithmetic: the
// caller supplies the clock and the rows, so the awkward cases (DST, a zone we
// cannot parse, a resend attempt within the same local day) are all testable
// without a Worker or a database.
import { isValidTimeZone } from './localDay';
import type { Lang } from './reading';

/** A reader whose browser never told us a zone still deserves a morning. */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export const SEND_HOUR = 6;

export interface Subscriber {
  email: string;
  lang: Lang;
  tz: string;
  lastSent: string | null;
}

export interface DueSubscriber extends Subscriber {
  /** The reader's own day, which is what gets written back to last_sent. */
  localDay: string;
}

export function localDayAndHour(now: Date, tz: string): { day: string; hour: number } {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  // 'en-CA' formats the date as YYYY-MM-DD; h23 keeps midnight at 0, not 24.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

export function dueNow(now: Date, subscribers: Subscriber[]): DueSubscriber[] {
  const due: DueSubscriber[] = [];
  for (const subscriber of subscribers) {
    const { day, hour } = localDayAndHour(now, subscriber.tz);
    if (hour !== SEND_HOUR) continue;
    // A string compare is correct for YYYY-MM-DD and avoids re-parsing dates.
    if (subscriber.lastSent && subscriber.lastSent >= day) continue;
    due.push({ ...subscriber, localDay: day });
  }
  return due;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/mailSchedule.test.ts`
Expected: PASS, 10 tests.

If the two DST assertions fail, do not adjust the implementation to match: verify the real UTC offsets for those dates first (`node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',hour:'2-digit',hourCycle:'h23'}).format(new Date('2026-03-08T13:00:00Z')))"`) and correct whichever side is actually wrong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mailSchedule.ts src/lib/__tests__/mailSchedule.test.ts
git commit -m "feat: select Daily Invitation subscribers due at 06:00 local"
```

---

### Task 3: Rendering the email

**Files:**
- Create: `src/lib/dailyEmail.ts`
- Test: `src/lib/__tests__/dailyEmail.test.ts`

**Interfaces:**
- Consumes: `getLectionaryDay(day: string): LectionaryDay` and `focusReference(day: LectionaryDay): string` from `src/lib/lectionary.ts`; `resolvePassage(ref: string, lang: Lang): ResolvedPassage | null` from `src/lib/passage.ts`.
- Produces: `SITE_ORIGIN`, `unsubscribeUrl(email: string, token: string): string`, and `renderDailyEmail(dayKey: string, lang: Lang, unsubscribeLink: string): { subject: string; html: string; text: string } | null`. Task 8 consumes both functions.

Returning `null` when the passage will not resolve is what implements the spec's "skip rather than mail a broken email".

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/dailyEmail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderDailyEmail, unsubscribeUrl } from '../dailyEmail';

const LINK = 'https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=abc';

describe('unsubscribeUrl', () => {
  it('escapes the address so a plus-addressed reader still unsubscribes', () => {
    const url = unsubscribeUrl('reader+daily@example.test', 'tok');
    expect(url).toBe('https://enjoyhim.org/unsubscribe?e=reader%2Bdaily%40example.test&t=tok');
  });
});

describe('renderDailyEmail', () => {
  it('renders an English morning with the day title, passage and a link to today', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    expect(mail).not.toBeNull();
    expect(mail!.subject.length).toBeGreaterThan(0);
    expect(mail!.html).toContain('https://enjoyhim.org/today');
    expect(mail!.html).toContain(LINK);
    expect(mail!.text).toContain(LINK);
    // The passage itself must be in the email, not only behind the link.
    expect(mail!.text.length).toBeGreaterThan(120);
  });

  it('renders Chinese copy and a Chinese reference for zh readers', () => {
    const mail = renderDailyEmail('2026-09-09', 'zh', LINK);
    expect(mail).not.toBeNull();
    expect(mail!.html).toMatch(/[一-鿿]/);
    expect(mail!.text).toMatch(/[一-鿿]/);
  });

  it('escapes the passage into HTML so scripture punctuation cannot break the markup', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    expect(mail!.html).not.toMatch(/<script/i);
    expect(mail!.html).toContain('<!doctype html>');
  });

  it('truncates a long passage rather than pasting a whole chapter into an inbox', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    const body = mail!.text;
    expect(body.length).toBeLessThan(2000);
  });

  it('returns null for a day whose passage cannot be resolved', () => {
    // Far outside the generated lectionary window and the bundled chapters.
    expect(renderDailyEmail('not-a-day', 'en', LINK)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/dailyEmail.test.ts`
Expected: FAIL, cannot resolve `../dailyEmail`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dailyEmail.ts`:

```ts
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

function truncate(text: string, lang: Lang): { body: string; truncated: boolean } {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/dailyEmail.test.ts`
Expected: PASS, 5 tests.

If `2026-09-09` has fallen outside the generated lectionary window by the time you run this, pick a day inside it (`node -e "const d=require('./src/lib/lectionaryDays.json');console.log(Object.keys(d)[0])"`) and use that key in the test instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailyEmail.ts src/lib/__tests__/dailyEmail.test.ts
git commit -m "feat: render the Daily Invitation email in both languages"
```

---

### Task 4: Resend batch client

**Files:**
- Create: `src/lib/resend.ts`
- Test: `src/lib/__tests__/resend.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FROM_ADDRESS`, `interface OutgoingMail { to: string; subject: string; html: string; text: string; unsubscribeUrl: string }`, `sendBatch(messages: OutgoingMail[], apiKey: string, fetchImpl?: typeof fetch): Promise<{ delivered: string[]; failed: string[] }>`. Task 8 consumes both the interface and the function.

- [ ] **Step 1: Verify the batch endpoint contract before writing code**

Read `https://resend.com/docs/api-reference/emails/send-batch-emails` and confirm two things: the request body is a bare JSON array of message objects, and per-message `headers` are accepted. If `headers` are rejected on the batch endpoint, note it in the commit message and set the `List-Unsubscribe` headers per message via the single-send endpoint in a loop instead; the rest of this task is unchanged. Do not guess - the one-click unsubscribe header is the difference between a native unsubscribe button and a spam report.

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/resend.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sendBatch, FROM_ADDRESS } from '../resend';
import type { OutgoingMail } from '../resend';

function mail(to: string): OutgoingMail {
  return {
    to,
    subject: 'A word for today',
    html: '<p>hello</p>',
    text: 'hello',
    unsubscribeUrl: `https://enjoyhim.org/unsubscribe?e=${encodeURIComponent(to)}&t=tok`,
  };
}

function okFetch() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 })
  );
}

describe('sendBatch', () => {
  it('posts to the batch endpoint with the project from-address', async () => {
    const fetchImpl = okFetch();
    await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails/batch');
    expect(init.headers.Authorization).toBe('Bearer key-123');
    const body = JSON.parse(init.body);
    expect(body[0].from).toBe(FROM_ADDRESS);
    expect(body[0].to).toEqual(['reader@example.test']);
  });

  it('attaches one-click unsubscribe headers so mail clients show the button', async () => {
    const fetchImpl = okFetch();
    await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body[0].headers['List-Unsubscribe']).toBe(
      '<https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=tok>'
    );
    expect(body[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('chunks at 100 messages per call', async () => {
    const fetchImpl = okFetch();
    const many = Array.from({ length: 250 }, (_, i) => mail(`r${i}@example.test`));
    const result = await sendBatch(many, 'key-123', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toHaveLength(50);
    expect(result.delivered).toHaveLength(250);
    expect(result.failed).toHaveLength(0);
  });

  it('reports a rejected chunk as failed instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const result = await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.delivered).toEqual([]);
    expect(result.failed).toEqual(['reader@example.test']);
  });

  it('keeps a good chunk when a later chunk fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const many = Array.from({ length: 150 }, (_, i) => mail(`r${i}@example.test`));
    const result = await sendBatch(many, 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.delivered).toHaveLength(100);
    expect(result.failed).toHaveLength(50);
  });

  it('reports a network error as failed rather than escaping to the caller', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await sendBatch([mail('reader@example.test')], 'key-123', fetchImpl as unknown as typeof fetch);
    expect(result.failed).toEqual(['reader@example.test']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/resend.test.ts`
Expected: FAIL, cannot resolve `../resend`.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/resend.ts`:

```ts
// A deliberately small Resend client: one endpoint, no SDK, injectable fetch so
// tests never touch the network.
const BATCH_URL = 'https://api.resend.com/emails/batch';

/** Resend's documented ceiling for one batch call. */
const CHUNK_SIZE = 100;

export const FROM_ADDRESS = 'The Daily Invitation <lectio@enjoyhim.org>';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export interface BatchResult {
  delivered: string[];
  failed: string[];
}

function toPayload(mail: OutgoingMail) {
  return {
    from: FROM_ADDRESS,
    to: [mail.to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // These two headers are what make Gmail and Apple Mail offer a native
    // unsubscribe control, which readers use instead of the spam button.
    headers: {
      'List-Unsubscribe': `<${mail.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export async function sendBatch(
  messages: OutgoingMail[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<BatchResult> {
  const delivered: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const response = await fetchImpl(BATCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.map(toPayload)),
      });
      if (!response.ok) {
        // Leave last_sent alone for these; the next hourly tick retries.
        console.error(
          'daily-invitation: resend rejected a batch:',
          response.status,
          await response.text().catch(() => '')
        );
        failed.push(...chunk.map((m) => m.to));
        continue;
      }
      delivered.push(...chunk.map((m) => m.to));
    } catch (e) {
      console.error('daily-invitation: resend call threw:', e);
      failed.push(...chunk.map((m) => m.to));
    }
  }

  return { delivered, failed };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/resend.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resend.ts src/lib/__tests__/resend.test.ts
git commit -m "feat: add a Resend batch client for the Daily Invitation"
```

---

### Task 5: Subscriber storage, schema, and timezone capture

**Files:**
- Create: `src/lib/subscribers.ts`
- Create: `scripts/migrate-daily-invitations.mjs`
- Modify: `src/pages/api/daily-invitation.ts` (whole file)
- Modify: `src/pages/index.astro:1483-1492`
- Test: `src/lib/__tests__/subscribers.test.ts`

**Interfaces:**
- Consumes: `Subscriber` and `DEFAULT_TIMEZONE` from `src/lib/mailSchedule.ts`.
- Produces: `CREATE_TABLE_SQL`, `ensureSubscriberTable(db)`, `addSubscriber(db, { email, lang, tz })`, `activeSubscribers(db): Promise<Subscriber[]>`, `markSent(db, emails: string[], localDay: string)`, `setStatus(db, email: string, status: 'unsubscribed' | 'bounced')`. Tasks 6, 7, and 8 all consume these.

This task moves every piece of `daily_invitations` SQL into one module. The API route keeps only request parsing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/subscribers.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  activeSubscribers,
  addSubscriber,
  ensureSubscriberTable,
  markSent,
  setStatus,
} from '../subscribers';

let db: any;

beforeEach(async () => {
  db = new D1Memory();
  await ensureSubscriberTable(db);
});

describe('subscriber storage', () => {
  it('stores an address with its language and timezone', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'Asia/Shanghai' });
    const rows = await activeSubscribers(db);
    expect(rows).toEqual([
      { email: 'reader@example.test', lang: 'en', tz: 'Asia/Shanghai', lastSent: null },
    ]);
  });

  it('defaults an unusable timezone to Pacific rather than rejecting the signup', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'Mars/Olympus' });
    expect((await activeSubscribers(db))[0].tz).toBe('America/Los_Angeles');
  });

  it('treats a repeat signup as an update, not an error', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'reader@example.test', lang: 'zh', tz: 'Asia/Shanghai' });
    const rows = await activeSubscribers(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].lang).toBe('zh');
    expect(rows[0].tz).toBe('Asia/Shanghai');
  });

  it('brings an unsubscribed reader back when they sign up again', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await setStatus(db, 'reader@example.test', 'unsubscribed');
    expect(await activeSubscribers(db)).toHaveLength(0);
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    expect(await activeSubscribers(db)).toHaveLength(1);
  });

  it('hides unsubscribed and bounced readers from the send list', async () => {
    await addSubscriber(db, { email: 'gone@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'bounced@example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'here@example.test', lang: 'en', tz: 'UTC' });
    await setStatus(db, 'gone@example.test', 'unsubscribed');
    await setStatus(db, 'bounced@example.test', 'bounced');
    expect((await activeSubscribers(db)).map((r) => r.email)).toEqual(['here@example.test']);
  });

  it('records the local day a send went out', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await markSent(db, ['reader@example.test'], '2026-09-09');
    expect((await activeSubscribers(db))[0].lastSent).toBe('2026-09-09');
  });

  it('marks nothing and does not throw when the delivered list is empty', async () => {
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    await markSent(db, [], '2026-09-09');
    expect((await activeSubscribers(db))[0].lastSent).toBeNull();
  });

  it('normalises the address so the same reader cannot enrol twice', async () => {
    await addSubscriber(db, { email: 'Reader@Example.test', lang: 'en', tz: 'UTC' });
    await addSubscriber(db, { email: 'reader@example.test', lang: 'en', tz: 'UTC' });
    expect(await activeSubscribers(db)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/subscribers.test.ts`
Expected: FAIL, cannot resolve `../subscribers`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/subscribers.ts`:

```ts
// Everything that knows the shape of daily_invitations. Routes and the cron
// handler talk to this module, never to SQL, so the schema has one owner.
import type { D1Database } from '@cloudflare/workers-types';
import { isValidTimeZone } from './localDay';
import { DEFAULT_TIMEZONE, type Subscriber } from './mailSchedule';
import type { Lang } from './reading';

export const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS daily_invitations (' +
  'email TEXT PRIMARY KEY, ' +
  'lang TEXT, ' +
  'created_at DATETIME DEFAULT CURRENT_TIMESTAMP, ' +
  "tz TEXT NOT NULL DEFAULT 'America/Los_Angeles', " +
  "status TEXT NOT NULL DEFAULT 'active', " +
  'last_sent TEXT)';

let initialized = false;

export async function ensureSubscriberTable(db: D1Database): Promise<void> {
  if (initialized) return;
  await db.exec(CREATE_TABLE_SQL);
  initialized = true;
}

/** Test seam: the module-level guard would otherwise leak between test files. */
export function resetSubscriberTableCache(): void {
  initialized = false;
}

export interface NewSubscriber {
  email: string;
  lang: Lang;
  tz: string;
}

export async function addSubscriber(db: D1Database, input: NewSubscriber): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const tz = isValidTimeZone(input.tz) ? input.tz : DEFAULT_TIMEZONE;
  // A returning reader is not an error, and someone re-subscribing after
  // unsubscribing means exactly that: put them back on the list.
  await db
    .prepare(
      'INSERT INTO daily_invitations (email, lang, tz, status) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(email) DO UPDATE SET lang = ?2, tz = ?3, status = ?4'
    )
    .bind(email, input.lang, tz, 'active')
    .run();
}

export async function activeSubscribers(db: D1Database): Promise<Subscriber[]> {
  const { results } = await db
    .prepare(
      "SELECT email, lang, tz, last_sent FROM daily_invitations WHERE status = 'active'"
    )
    .bind()
    .all<{ email: string; lang: string; tz: string; last_sent: string | null }>();

  return (results ?? []).map((row) => ({
    email: row.email,
    lang: row.lang === 'zh' ? 'zh' : 'en',
    tz: row.tz ?? DEFAULT_TIMEZONE,
    lastSent: row.last_sent ?? null,
  }));
}

export async function markSent(
  db: D1Database,
  emails: string[],
  localDay: string
): Promise<void> {
  if (emails.length === 0) return;
  const statements = emails.map((email) =>
    db
      .prepare('UPDATE daily_invitations SET last_sent = ?1 WHERE email = ?2')
      .bind(localDay, email)
  );
  await db.batch(statements);
}

export async function setStatus(
  db: D1Database,
  email: string,
  status: 'unsubscribed' | 'bounced'
): Promise<void> {
  await db
    .prepare('UPDATE daily_invitations SET status = ?1 WHERE email = ?2')
    .bind(status, email.trim().toLowerCase())
    .run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/subscribers.test.ts`
Expected: PASS, 8 tests.

If `markSent` fails because `D1Memory` has no `batch`, add one to `src/lib/__tests__/helpers/d1-memory.ts`:

```ts
  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    const out = [];
    for (const statement of statements) out.push(await statement.run());
    return out;
  }
```

- [ ] **Step 5: Rewrite the signup route to use it**

Replace the whole of `src/pages/api/daily-invitation.ts`:

```ts
// The Daily Invitation: a quiet morning-verse email list.
// Stores an address, a language, and a timezone; src/worker.ts reads the table
// on its hourly tick and sends at 06:00 in the reader's own morning.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { addSubscriber, ensureSubscriberTable } from '../../lib/subscribers';
import { DEFAULT_TIMEZONE } from '../../lib/mailSchedule';

// Deliberately plain: an address, not a profile.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let lang: 'en' | 'zh' = 'en';
  let tz = DEFAULT_TIMEZONE;
  try {
    const body = (await request.json()) as {
      email?: unknown;
      lang?: unknown;
      tz?: unknown;
    };
    email = String(body.email ?? '').trim().toLowerCase();
    lang = body.lang === 'zh' ? 'zh' : 'en';
    // The browser knows the reader's zone; an absent or odd one is not worth
    // failing a signup over, so addSubscriber falls back for us.
    if (typeof body.tz === 'string' && body.tz) tz = body.tz;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_request' }), { status: 400 });
  }

  if (!EMAIL_RE.test(email) || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), { status: 400 });
  }

  try {
    const db = env.DB as D1Database;
    await ensureSubscriberTable(db);
    await addSubscriber(db, { email, lang, tz });
  } catch (e) {
    console.error('daily-invitation: store failed:', e);
    return new Response(JSON.stringify({ ok: false, error: 'storage' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

- [ ] **Step 6: Send the timezone from the signup form**

In `src/pages/index.astro`, inside the `invite-form` submit handler, replace these two lines:

```ts
        const lang = document.documentElement.lang === 'zh' ? 'zh' : 'en';
```

with:

```ts
        const lang = document.documentElement.lang === 'zh' ? 'zh' : 'en';
        // So the invitation arrives in this reader's morning, not ours.
        let tz = '';
        try {
          tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
        } catch {
          tz = '';
        }
```

and change the request body from:

```ts
            body: JSON.stringify({ email, lang }),
```

to:

```ts
            body: JSON.stringify({ email, lang, tz }),
```

- [ ] **Step 7: Write the production migration script**

Create `scripts/migrate-daily-invitations.mjs`:

```js
// Adds tz, status and last_sent to an existing daily_invitations table.
// SQLite has no ADD COLUMN IF NOT EXISTS, so read the table first and add only
// what is missing. Safe to run more than once.
//
// Usage: node scripts/migrate-daily-invitations.mjs [--local]
import { execFileSync } from 'node:child_process';

const DB = 'lectio-readings';
const local = process.argv.includes('--local');

const COLUMNS = [
  ["tz", "ALTER TABLE daily_invitations ADD COLUMN tz TEXT NOT NULL DEFAULT 'America/Los_Angeles'"],
  ["status", "ALTER TABLE daily_invitations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ["last_sent", "ALTER TABLE daily_invitations ADD COLUMN last_sent TEXT"],
];

function d1(sql) {
  const args = ['wrangler', 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql];
  return execFileSync('npx', args, { encoding: 'utf8' });
}

const info = JSON.parse(d1('PRAGMA table_info(daily_invitations)'));
const existing = new Set((info[0]?.results ?? []).map((row) => row.name));

if (existing.size === 0) {
  console.error('daily_invitations does not exist yet; the signup route creates it on first use.');
  process.exit(1);
}

for (const [name, sql] of COLUMNS) {
  if (existing.has(name)) {
    console.log(`ok: ${name} already present`);
    continue;
  }
  d1(sql);
  console.log(`added: ${name}`);
}

console.log(d1('SELECT email, lang, tz, status, last_sent FROM daily_invitations'));
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npx astro check`
Expected: PASS. Existing tests that referenced the old `CREATE TABLE` in the route must be updated to import from `subscribers.ts` if any exist.

- [ ] **Step 9: Commit**

```bash
git add src/lib/subscribers.ts src/lib/__tests__/subscribers.test.ts src/lib/__tests__/helpers/d1-memory.ts src/pages/api/daily-invitation.ts src/pages/index.astro scripts/migrate-daily-invitations.mjs
git commit -m "feat: capture subscriber timezone and status for the Daily Invitation"
```

---

### Task 6: One-click unsubscribe

**Files:**
- Create: `src/pages/unsubscribe.astro`
- Test: `src/lib/__tests__/unsubscribe-route.test.ts`

**Interfaces:**
- Consumes: `verifyMailToken` (Task 1), `setStatus`, `ensureSubscriberTable` (Task 5).
- Produces: the route only. Task 8 links to it via `unsubscribeUrl` from Task 3.

The page must answer identically whether or not the address is on the list, so it cannot be used to test which addresses we hold.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unsubscribe-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: { DB: {}, MAIL_TOKEN_SECRET: 'test-mail-secret' } }));
vi.mock('../subscribers', () => ({
  ensureSubscriberTable: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
}));
import { setStatus } from '../subscribers';
import { signMailToken } from '../mailToken';
import { unsubscribeFromRequest } from '../../pages/unsubscribe.astro';

const SECRET = 'test-mail-secret';

beforeEach(() => vi.clearAllMocks());

describe('unsubscribe', () => {
  it('removes a reader whose token checks out', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    const url = new URL(`https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=${token}`);
    expect(await unsubscribeFromRequest(url)).toBe(true);
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'unsubscribed');
  });

  it('changes nothing when the token is wrong', async () => {
    const url = new URL('https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=forged');
    expect(await unsubscribeFromRequest(url)).toBe(false);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('changes nothing when the address is missing', async () => {
    const url = new URL('https://enjoyhim.org/unsubscribe?t=whatever');
    expect(await unsubscribeFromRequest(url)).toBe(false);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('accepts a plus-addressed reader', async () => {
    const token = await signMailToken('reader+daily@example.test', SECRET);
    const url = new URL(
      `https://enjoyhim.org/unsubscribe?e=${encodeURIComponent('reader+daily@example.test')}&t=${token}`
    );
    expect(await unsubscribeFromRequest(url)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/unsubscribe-route.test.ts`
Expected: FAIL, cannot resolve `../../pages/unsubscribe.astro`.

- [ ] **Step 3: Write minimal implementation**

Create `src/pages/unsubscribe.astro`. Note that the logic lives in an exported function in the frontmatter so the test can call it without rendering:

```astro
---
// Leaving is as quiet as arriving. The page renders the same confirmation
// whether or not the token was good, so it cannot be used to probe the list.
import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import Layout from '../layouts/Layout.astro';
import { verifyMailToken } from '../lib/mailToken';
import { ensureSubscriberTable, setStatus } from '../lib/subscribers';

export async function unsubscribeFromRequest(url: URL): Promise<boolean> {
  const email = (url.searchParams.get('e') ?? '').trim().toLowerCase();
  const token = url.searchParams.get('t') ?? '';
  if (!email || !token) return false;

  const secret = env.MAIL_TOKEN_SECRET as string | undefined;
  if (!secret) {
    console.error('daily-invitation: MAIL_TOKEN_SECRET is not set; cannot unsubscribe');
    return false;
  }
  if (!(await verifyMailToken(email, token, secret))) return false;

  const db = env.DB as D1Database;
  await ensureSubscriberTable(db);
  await setStatus(db, email, 'unsubscribed');
  return true;
}

// One-click unsubscribe arrives as a POST from the mail client, a footer link
// as a GET. Both mean the same thing.
await unsubscribeFromRequest(Astro.url);

const lang = Astro.url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
---

<Layout title={lang === 'zh' ? '已退订' : 'Unsubscribed'}>
  <section class="unsubscribe">
    <h1>{lang === 'zh' ? '已经取消' : 'That is done'}</h1>
    <p>
      {lang === 'zh'
        ? '早晨的邀请不会再来了。若哪天想再听见，随时回来。'
        : 'The morning invitation will not arrive again. Come back whenever you would like to hear it.'}
    </p>
    <p><a href="/">{lang === 'zh' ? '回到首页' : 'Back to the beginning'}</a></p>
  </section>
</Layout>

<style>
  .unsubscribe {
    max-width: 34em;
    margin: 12vh auto;
    padding: 0 1.5rem;
    text-align: center;
  }
</style>
```

- [ ] **Step 4: Confirm the layout import is right**

Run: `ls src/layouts/` and adjust the `Layout` import path and its props to match how other simple pages such as `src/pages/privacy.astro` use it. Do not invent props the layout does not accept.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/unsubscribe-route.test.ts`
Expected: PASS, 4 tests.

If Vitest cannot import from a `.astro` file, move `unsubscribeFromRequest` into `src/lib/unsubscribe.ts`, import it from the page frontmatter, and point the test at `../unsubscribe`. That is the better structure anyway if it comes to it.

- [ ] **Step 6: Commit**

```bash
git add src/pages/unsubscribe.astro src/lib/__tests__/unsubscribe-route.test.ts
git commit -m "feat: honour one-click unsubscribe for the Daily Invitation"
```

---

### Task 7: Bounce and complaint suppression

**Files:**
- Create: `src/pages/api/resend-webhook.ts`
- Test: `src/lib/__tests__/resend-webhook.test.ts`

**Interfaces:**
- Consumes: `setStatus`, `ensureSubscriberTable` (Task 5).
- Produces: the route only.

With single opt-in this is the only thing protecting the sending domain, so it ships with the first send, not after.

- [ ] **Step 1: Confirm the signature scheme**

Read `https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests`. Resend signs with Svix: headers `svix-id`, `svix-timestamp`, `svix-signature`; the signed payload is `${svix-id}.${svix-timestamp}.${rawBody}`; the secret is the base64 portion after the `whsec_` prefix; `svix-signature` is a space-separated list of `v1,<base64 signature>` entries. Confirm this before writing `verifyWebhook` and correct the implementation below if the docs differ.

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/resend-webhook.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, RESEND_WEBHOOK_SECRET: 'whsec_c2VjcmV0LWZvci10ZXN0aW5n' },
}));
vi.mock('../subscribers', () => ({
  ensureSubscriberTable: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
}));
import { setStatus } from '../subscribers';
import { POST } from '../../pages/api/resend-webhook';

const SECRET_B64 = 'c2VjcmV0LWZvci10ZXN0aW5n';

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(SECRET_B64), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

async function post(event: unknown, { valid = true } = {}) {
  const body = JSON.stringify(event);
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = valid ? await sign(id, timestamp, body) : 'v1,bm90LWEtc2lnbmF0dXJl';
  return POST({
    request: new Request('https://enjoyhim.org/api/resend-webhook', {
      method: 'POST',
      body,
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
    }),
  } as any);
}

beforeEach(() => vi.clearAllMocks());

describe('resend webhook', () => {
  it('suppresses an address that hard bounced', async () => {
    const response = await post({
      type: 'email.bounced',
      data: { to: ['reader@example.test'], bounce: { type: 'Permanent' } },
    });
    expect(response.status).toBe(200);
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'bounced');
  });

  it('suppresses an address that complained', async () => {
    await post({ type: 'email.complained', data: { to: ['reader@example.test'] } });
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'bounced');
  });

  it('leaves a soft bounce alone, since the next morning may well work', async () => {
    await post({
      type: 'email.bounced',
      data: { to: ['reader@example.test'], bounce: { type: 'Transient' } },
    });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('ignores events it does not act on', async () => {
    const response = await post({ type: 'email.delivered', data: { to: ['reader@example.test'] } });
    expect(response.status).toBe(200);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const response = await post(
      { type: 'email.complained', data: { to: ['reader@example.test'] } },
      { valid: false }
    );
    expect(response.status).toBe(401);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/resend-webhook.test.ts`
Expected: FAIL, cannot resolve `../../pages/api/resend-webhook`.

- [ ] **Step 4: Write minimal implementation**

Create `src/pages/api/resend-webhook.ts`:

```ts
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

/** Svix signing, as Resend documents it. */
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/resend-webhook.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/resend-webhook.ts src/lib/__tests__/resend-webhook.test.ts
git commit -m "feat: suppress bounced and complaining Daily Invitation addresses"
```

---

### Task 8: The hourly send

**Files:**
- Create: `src/worker.ts`
- Create: `src/lib/sendDaily.ts`
- Modify: `astro.config.mjs`
- Modify: `wrangler.jsonc`
- Test: `src/lib/__tests__/worker-scheduled.test.ts`

**Interfaces:**
- Consumes: `dueNow`, `Subscriber` (Task 2); `renderDailyEmail`, `unsubscribeUrl` (Task 3); `sendBatch`, `OutgoingMail` (Task 4); `activeSubscribers`, `markSent`, `ensureSubscriberTable` (Task 5); `signMailToken` (Task 1).
- Produces: `sendDailyInvitations(deps): Promise<{ sent: number; skipped: number }>`.

The logic lives in `src/lib/sendDaily.ts` with every dependency injected, so it is testable without a Worker. `src/worker.ts` is only wiring.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/worker-scheduled.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import { sendDailyInvitations } from '../sendDaily';
import { addSubscriber, ensureSubscriberTable, activeSubscribers } from '../subscribers';

const SECRET = 'test-mail-secret';
const API_KEY = 'key-123';
// 13:00Z is 06:00 in Los Angeles on this date.
const SIX_AM_PACIFIC = new Date('2026-09-09T13:00:00Z');

let db: any;

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
}

beforeEach(async () => {
  db = new D1Memory();
  await ensureSubscriberTable(db);
});

describe('sendDailyInvitations', () => {
  it('sends one batch to the readers whose morning it is and records the day', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    await addSubscriber(db, { email: 'sh@example.test', lang: 'zh', tz: 'Asia/Shanghai' });
    const fetchImpl = okFetch();

    const result = await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toHaveLength(1);
    expect(body[0].to).toEqual(['la@example.test']);
    expect(result.sent).toBe(1);

    const rows = await activeSubscribers(db);
    expect(rows.find((r) => r.email === 'la@example.test')!.lastSent).toBe('2026-09-09');
    expect(rows.find((r) => r.email === 'sh@example.test')!.lastSent).toBeNull();
  });

  it('does nothing at all when no one is due', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const result = await sendDailyInvitations({
      db,
      now: new Date('2026-09-09T20:00:00Z'),
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('leaves last_sent untouched when Resend rejects the batch, so the next tick retries', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));

    const result = await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sent).toBe(0);
    expect((await activeSubscribers(db))[0].lastSent).toBeNull();
  });

  it('does not send the same reader twice in one local day', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const deps = {
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    await sendDailyInvitations(deps);
    await sendDailyInvitations(deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives every reader an unsubscribe link that verifies', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    await sendDailyInvitations({
      db,
      now: SIX_AM_PACIFIC,
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const header = body[0].headers['List-Unsubscribe'];
    const url = new URL(header.slice(1, -1));
    const { verifyMailToken } = await import('../mailToken');
    expect(await verifyMailToken(url.searchParams.get('e')!, url.searchParams.get('t')!, SECRET))
      .toBe(true);
  });

  it('skips a reader whose passage will not resolve rather than mailing a broken email', async () => {
    await addSubscriber(db, { email: 'la@example.test', lang: 'en', tz: 'America/Los_Angeles' });
    const fetchImpl = okFetch();
    const result = await sendDailyInvitations({
      db,
      // A date far outside the generated lectionary window.
      now: new Date('1990-01-01T14:00:00Z'),
      apiKey: API_KEY,
      tokenSecret: SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.skipped).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/worker-scheduled.test.ts`
Expected: FAIL, cannot resolve `../sendDaily`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sendDaily.ts`:

```ts
// One hourly tick of the Daily Invitation. Every dependency is injected so the
// whole send can be exercised in a unit test with an in-memory database and a
// fake fetch.
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
  // with the day that was actually theirs.
  const dayFor = new Map<string, string>();
  let skipped = 0;

  for (const subscriber of due) {
    const token = await signMailToken(subscriber.email, deps.tokenSecret);
    const link = unsubscribeUrl(subscriber.email, token);
    const rendered = renderDailyEmail(subscriber.localDay, subscriber.lang, link);
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
    // Deliberately not marked: the next hourly tick tries them again.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/worker-scheduled.test.ts`
Expected: PASS, 6 tests.

`ensureSubscriberTable` caches on a module-level flag. If tests interfere, call `resetSubscriberTableCache()` in `beforeEach`.

- [ ] **Step 5: Write the Worker entry point**

Create `src/worker.ts`:

```ts
// The Astro adapter's entry plus a cron handler. Wiring only: the decisions all
// live in src/lib/sendDaily.ts, which is where the tests point.
import handler from 'astro/app/cloudflare';
import { sendDailyInvitations } from './lib/sendDaily';

export default {
  ...handler,
  async scheduled(_controller: ScheduledController, env: any, ctx: ExecutionContext) {
    const apiKey = env.RESEND_API_KEY as string | undefined;
    const tokenSecret = env.MAIL_TOKEN_SECRET as string | undefined;
    if (!apiKey || !tokenSecret) {
      // Loud, but not a throw: a misconfigured secret should not turn every
      // hourly tick into a Cloudflare error alert.
      console.error('daily-invitation: RESEND_API_KEY or MAIL_TOKEN_SECRET missing; not sending');
      return;
    }

    ctx.waitUntil(
      sendDailyInvitations({ db: env.DB, now: new Date(), apiKey, tokenSecret })
        .then((result) =>
          console.log('daily-invitation: sent', result.sent, 'skipped', result.skipped)
        )
        .catch((e) => console.error('daily-invitation: send failed:', e))
    );
  },
};
```

The exact import specifier for the adapter's default handler depends on `@astrojs/cloudflare` v14. Before writing this file, check the installed package: `cat node_modules/@astrojs/cloudflare/README.md | grep -A 20 -i "workerEntryPoint"`. Use whatever import and export shape that documents. Do not guess.

- [ ] **Step 6: Point the adapter at it**

In `astro.config.mjs`:

```js
  adapter: cloudflare({
    imageService: 'passthrough',
    workerEntryPoint: { path: './src/worker.ts' },
  }),
```

- [ ] **Step 7: Add the cron trigger**

In `wrangler.jsonc`, after the `"observability"` block:

```jsonc
	// Hourly, not daily: subscribers are spread across timezones and each is
	// sent at 06:00 in their own. Most ticks do no work.
	"triggers": {
		"crons": ["0 * * * *"]
	},
```

- [ ] **Step 8: Verify the build and the whole suite**

Run: `npm run build && npm test && npx astro check`
Expected: PASS. The build must still emit a working `dist/`; `scripts/check-build-output.mjs` runs in `npm run deploy` and will catch a broken entry point.

- [ ] **Step 9: Commit**

```bash
git add src/worker.ts src/lib/sendDaily.ts src/lib/__tests__/worker-scheduled.test.ts astro.config.mjs wrangler.jsonc
git commit -m "feat: send the Daily Invitation on an hourly cron"
```

---

### Task 9: Secrets, migration, and end-to-end verification

**Files:**
- Create: `scripts/push-mail-secrets.mjs`
- Test: manual, end to end.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified send.

- [ ] **Step 1: Write the secrets script**

Read `scripts/push-stripe-secrets.mjs` first and follow its structure exactly, including how it reads from `.dev.vars` or the environment and how it reports what it pushed. Create `scripts/push-mail-secrets.mjs` for `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `MAIL_TOKEN_SECRET`, matching that file's conventions rather than inventing new ones.

- [ ] **Step 2: Generate and set the token secret**

```bash
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

Put that value, plus the Resend API key and webhook secret, in `.dev.vars` for local runs, then push them with `node scripts/push-mail-secrets.mjs`. Never commit `.dev.vars`.

- [ ] **Step 3: Resend account setup (manual, once)**

1. Verify `enjoyhim.org` in Resend; add the DKIM, SPF, and return-path records to the Cloudflare zone.
2. Wait for verification to go green before any send.
3. Add a webhook pointing at `https://enjoyhim.org/api/resend-webhook`, subscribed to `email.bounced` and `email.complained`. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.

- [ ] **Step 4: Migrate the production table**

```bash
node scripts/migrate-daily-invitations.mjs --local   # confirm it is a no-op or adds cleanly
node scripts/migrate-daily-invitations.mjs           # production
```

Expected: three `added:` lines the first time, three `ok:` lines on a rerun, then a dump showing the existing subscriber with `tz=America/Los_Angeles`, `status=active`, `last_sent=NULL`.

- [ ] **Step 5: End-to-end, as a reader would experience it**

```bash
npx wrangler dev --test-scheduled
```

1. Open the home page, scroll to The Daily Invitation, sign up with a real address you control.
2. Confirm in the network tab that the POST body carries a `tz`.
3. Confirm the row landed: `npx wrangler d1 execute lectio-readings --local --command "SELECT * FROM daily_invitations"`.
4. Temporarily set that row's `tz` to a zone where it is currently 06:00, so the tick has work to do:
   `npx wrangler d1 execute lectio-readings --local --command "UPDATE daily_invitations SET tz='<zone>'"`.
5. Fire the cron: `curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"`.
6. Confirm the email arrives. Read it on a phone as well as a desktop client. Per the project standard, be picky: if the passage wraps badly, the type is too small, the link is not obviously tappable, or the Chinese text renders in a fallback serif, fix it before moving on.
7. Click the footer unsubscribe link, confirm the page reads well, and confirm the row flipped to `unsubscribed`.
8. Confirm the mail client shows its own native unsubscribe control next to the sender name.
9. Fire the cron again and confirm no second email arrives.

- [ ] **Step 6: Deploy and watch the first real morning**

```bash
npm run deploy
```

Then confirm in the Cloudflare dashboard that the cron trigger is registered and check the Workers logs at the next 06:00 Pacific for a `daily-invitation: sent` line.

- [ ] **Step 7: Commit**

```bash
git add scripts/push-mail-secrets.mjs
git commit -m "chore: add a secret push script for the Daily Invitation"
```

---

## Self-Review Notes

Spec coverage checked section by section: custom worker entry (Task 8), hourly cron (Task 8), Resend batch and from-address (Task 4), schema change and migration (Task 5), timezone capture (Task 5), idempotency via `last_sent` (Tasks 5 and 8), all five modules (Tasks 1-5, 8), unsubscribe route with `List-Unsubscribe` headers (Tasks 4 and 6), webhook suppression (Task 7), every row of the failure table (Tasks 4, 6, 7, 8), every named test file (Tasks 1-8), secrets and manual setup (Task 9).

Two places deliberately tell the implementer to verify against upstream documentation rather than trust this plan: the Resend batch `headers` contract (Task 4, Step 1) and the `@astrojs/cloudflare` v14 entry point shape (Task 8, Step 5). Both are external contracts that a plan written today can get wrong, and both fail loudly rather than silently if assumed.

The spec named a module `src/lib/resend.ts` holding `sendBatch` and a `src/worker.ts` holding the send logic. This plan splits the send logic into `src/lib/sendDaily.ts` and leaves `src/worker.ts` as wiring, because logic inside a Worker entry point cannot be unit tested without a Worker runtime. That is a refinement of the spec's intent, not a departure from it.
