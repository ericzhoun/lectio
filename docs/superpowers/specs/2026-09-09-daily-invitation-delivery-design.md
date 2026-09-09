# The Daily Invitation: Delivery

Date: 2026-09-09
Status: approved design, not yet implemented

## Problem

`/api/daily-invitation` stores addresses in the D1 table `daily_invitations`
and nothing ever reads them. The signup form on the home page succeeds, the
success note appears, and no email is ever sent. There is no cron trigger in
`wrangler.jsonc`, no `scheduled()` handler, and no email provider anywhere in
the repository. The footer under the form promises "unsubscribe anytime",
which today is untrue because there is nothing to unsubscribe from and no
route that would honour it.

Confirmed in production: `daily_invitations` holds one row
(`ericzhouh@gmail.com`, `en`, `2026-09-08 02:40:56`). Capture works. Delivery
was never built.

## Goal

A reader who signs up receives one quiet email each morning at 06:00 in their
own local time, containing the day's lectionary title, the focus gospel
passage, and a link to `/today`. They can unsubscribe in one click. Addresses
that hard bounce or complain stop receiving mail without manual intervention.

## Non-goals

- Double opt-in. Decided against: the list is small and the friction is not
  worth it at this size. The bounce and complaint suppression described below
  is what protects domain reputation instead. Revisit if signup volume grows
  or if Resend reports a bounce rate above roughly 2 percent.
- Per-reader send-time preferences beyond timezone.
- An archive or web view of past invitations.
- Reflections generated per day by an LLM. The email carries scripture that
  is already resolvable offline.

## Architecture

### Where the cron runs

`@astrojs/cloudflare` v14 accepts a custom entry point:

```js
adapter: cloudflare({
  imageService: 'passthrough',
  workerEntryPoint: { path: './src/worker.ts' },
})
```

`src/worker.ts` re-exports the adapter's default fetch handler and adds
`scheduled()`. One Worker, one deploy, one set of bindings, and the send path
imports `src/lib/lectionary.ts` and `src/lib/passage.ts` directly.

A separate mailer Worker was considered and rejected: it would duplicate
bindings and secrets, add a second deploy target to `npm run deploy`, and buy
isolation the workload does not need.

`wrangler.jsonc` gains:

```jsonc
"triggers": { "crons": ["0 * * * *"] }
```

Hourly, because subscribers are spread across timezones and each should get a
06:00 local email. Most invocations do no work.

### Provider

Resend, via `POST https://api.resend.com/emails/batch` (up to 100 messages per
call). Chosen for a plain REST API that works from a Worker with only an API
key, a free tier that covers current volume, and bounce and complaint
webhooks.

From-address: `lectio@enjoyhim.org`.

DNS records for DKIM, SPF, and the return path are added to the `enjoyhim.org`
zone from the Resend dashboard. This is manual setup, done once, before the
first send.

## Data

### Schema change

`daily_invitations` today:

```
email      TEXT PRIMARY KEY
lang       TEXT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

Three columns are added:

```
tz         TEXT NOT NULL DEFAULT 'UTC'
status     TEXT NOT NULL DEFAULT 'active'
last_sent  TEXT
```

- `tz` is an IANA zone name captured in the browser at signup time with
  `Intl.DateTimeFormat().resolvedOptions().timeZone`, validated server-side by
  the existing `isValidTimeZone` in `src/lib/localDay.ts`. An invalid or
  missing value falls back to `UTC`.
- `status` is one of `active`, `unsubscribed`, `bounced`. Only `active` rows
  receive mail.
- `last_sent` is the reader's own local day as `YYYY-MM-DD`, written after
  Resend accepts a batch.

Existing rows take the column defaults, so the one production subscriber
becomes `tz='UTC'`, `status='active'`, `last_sent=NULL` and starts receiving
mail at 06:00 UTC until that reader's timezone is known.

The repository has no migrations directory; the established pattern is
`CREATE TABLE IF NOT EXISTS` executed lazily from application code. This
design keeps that pattern for fresh databases and adds a one-off script,
`scripts/migrate-daily-invitations.mjs`, that issues the three
`ALTER TABLE ... ADD COLUMN` statements against the production database.
SQLite has no `ADD COLUMN IF NOT EXISTS`, so the script reads
`PRAGMA table_info(daily_invitations)` first and adds only the columns that
are absent, making it safe to run more than once. The `CREATE TABLE` statement
in `src/pages/api/daily-invitation.ts` is updated to include all six columns
so a fresh database needs no migration.

### Idempotency

`last_sent` is the guard; there is no separate send log. A row is eligible
only when `last_sent` is null or strictly less than the reader's current local
day. The write happens after Resend accepts the batch, never before. A crash
between the API call and the write therefore risks one duplicate on the next
hourly tick, which is strictly better than a silent skipped day.

## Modules

Each is a small unit with one purpose, testable without a Worker runtime.

### `src/lib/mailToken.ts`

```ts
export function signMailToken(email: string, secret: string): Promise<string>
export function verifyMailToken(email: string, token: string, secret: string): Promise<boolean>
```

HMAC-SHA256 over the lowercased address via `crypto.subtle`, base64url
encoded, compared in constant time. Pure apart from `crypto`, which is
available in both Workers and the Vitest environment. Tokens do not expire: an
unsubscribe link in an old email must keep working.

`src/lib/crypto.ts` holds password hashing only and is left alone; mixing
concerns there would make both harder to read.

### `src/lib/dailyEmail.ts`

```ts
export function renderDailyEmail(day: LectionaryDay, dayKey: string, lang: Lang, unsubscribeUrl: string):
  { subject: string; html: string; text: string }
```

Pure. Composes the day title from `lectionary.ts`, the focus passage text from
`passage.ts`, a single link to `https://enjoyhim.org/today`, and a footer with
the unsubscribe link. Emits both HTML and a plain-text alternative. Long
passages are truncated to a readable excerpt with a "read the rest" link
rather than pasting an entire chapter into an inbox.

Copy is bilingual, following the `lang` column and the existing `i18n.ts`
conventions.

### `src/lib/resend.ts`

```ts
export interface ResendMessage { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }
export async function sendBatch(messages: ResendMessage[], apiKey: string, fetchImpl?: typeof fetch): Promise<BatchResult>
```

Thin. Chunks into groups of 100, sets the `from` address, and returns per
address success or failure. `fetchImpl` is injectable so tests never touch the
network.

### `src/lib/mailSchedule.ts`

```ts
export interface Subscriber { email: string; lang: Lang; tz: string; lastSent: string | null }
export function dueNow(now: Date, subscribers: Subscriber[], hour?: number): Subscriber[]
```

Pure timezone arithmetic: a subscriber is due when the local hour in their
`tz` equals 6 and their local day is later than `last_sent`. Uses
`Intl.DateTimeFormat` with the zone, the same technique as `localDay.ts`,
which means DST transitions are handled by the platform rather than by hand.
This is the piece most likely to be subtly wrong, so it is isolated and
heavily tested.

### `src/worker.ts`

Adapter entry plus `scheduled()`. Glue only: read subscribers, call `dueNow`,
render, send, mark. No logic that is not about wiring.

## Routes

### `GET /unsubscribe?e=<email>&t=<token>`

Verifies the token, sets `status='unsubscribed'`, and renders a short page
confirming it, in the reader's language. An invalid token renders the same
confirmation-shaped page without changing anything, so the endpoint cannot be
used to probe which addresses are on the list.

Every sent message also carries `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers pointing at this
URL, which is what makes Gmail and Apple Mail show a native unsubscribe
control. One-click unsubscribe arrives as a POST, so the route handles both
verbs.

### `POST /api/resend-webhook`

Receives `email.bounced` and `email.complained` events, verifies the Svix
signature using `RESEND_WEBHOOK_SECRET`, and sets `status='bounced'` for the
affected address. Soft bounces are ignored; only hard bounces and complaints
suppress. This is the mechanism that substitutes for double opt-in, so it is
part of the initial implementation and not a follow-up.

### `POST /api/daily-invitation` (existing)

Gains a `tz` field in the request body, validated with `isValidTimeZone`. The
client script in `src/pages/index.astro` sends
`Intl.DateTimeFormat().resolvedOptions().timeZone` alongside the address. A
resubscribe after unsubscribing resets `status` to `active` via the existing
upsert, changing `ON CONFLICT DO NOTHING` to an update of `lang`, `tz`, and
`status`.

## Failure handling

| Failure | Behaviour |
|---------|-----------|
| `RESEND_API_KEY` unset | `scheduled()` logs an error and returns. No throw, no partial state. |
| Resend returns non-2xx | Log the status and body, do not write `last_sent`. The next hourly tick retries. |
| Individual address fails inside a batch | Mark only the addresses that succeeded. |
| Passage resolution fails for the day | Skip the entire send for that day rather than mail a broken email. Log loudly. |
| D1 unavailable | The cron invocation fails and Cloudflare records it. No retry logic beyond the next tick. |
| Reader has an invalid stored tz | Treated as `UTC` at read time, so they still receive mail. |

Every path logs through `console.error` with a `daily-invitation:` prefix,
matching the existing convention in the API route, and is visible through the
Workers observability already enabled in `wrangler.jsonc`.

## Testing

Unit, with Vitest, following `src/lib/__tests__`:

- `mailToken.test.ts` - round trip, tampered token rejected, wrong secret
  rejected, case normalisation.
- `mailSchedule.test.ts` - due at 06:00 local across several zones, not due at
  other hours, not due twice in one local day, correct behaviour across a
  spring-forward and a fall-back date, invalid tz treated as UTC.
- `dailyEmail.test.ts` - en and zh rendering, unsubscribe link present in both
  HTML and text, long passage truncation.
- `resend.test.ts` - chunking at 100, injected fetch receives the expected
  body, non-2xx surfaces as failure rather than throwing.
- `worker-scheduled.test.ts` - fake D1 and fake fetch; asserts exactly one
  batch call, that `last_sent` is written only for accepted addresses, and
  that a Resend failure leaves `last_sent` untouched.
- `unsubscribe-route.test.ts` - valid token flips status, invalid token does
  not, POST and GET both work.

End to end, per the project convention of reproducing user-visible behaviour:
sign up through the real form in `wrangler dev`, then trigger
`/__scheduled?cron=0+*+*+*+*` with `wrangler dev --test-scheduled` and confirm
a message reaches a real inbox with a working unsubscribe link.

## Secrets and manual setup

Set out of band, not in the repository:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `MAIL_TOKEN_SECRET` - 32 random bytes, base64

A `scripts/push-mail-secrets.mjs` follows the existing
`push-google-secrets.mjs` and `push-stripe-secrets.mjs` pattern.

Manual, once, before the first send:

1. Verify `enjoyhim.org` in Resend and add the DKIM, SPF, and return-path DNS
   records to the Cloudflare zone.
2. Point a Resend webhook at `https://enjoyhim.org/api/resend-webhook` for
   `email.bounced` and `email.complained`.
3. Run `scripts/migrate-daily-invitations.mjs` against production D1.

## Open risk

Single opt-in means anyone can subscribe any address. The mitigations are
one-click unsubscribe in the mail client, automatic suppression on complaint,
and low volume. If the complaint rate rises, double opt-in is the answer and
the schema already has a `status` column that can take a `pending` value
without another migration.
