# Subscription Tiers Design

Date: 2026-08-27
Status: Approved for planning

## Context

Inspire (self-inspiring tarot) is an Astro app on Cloudflare Workers with
a D1 database (`inspire-readings`), currently storing only anonymous
`drawing_sessions`. There is no authentication and no billing. This spec
adds three subscription tiers (Free / Basic / Pro) gating spread choice,
daily draw quota, and reading history, billed via Stripe.

Butterbase (a separate AI-native BaaS with its own Postgres/auth/Stripe
Connect) was evaluated and rejected: it would duplicate the existing D1
database and add an unrelated platform (Node/TS SDK, OAuth signup) for
no benefit over building directly on the stack already in place.

## Goals

- Real user accounts (email + password) so a subscription ties to a person.
- Three tiers: Free, Basic, Pro — gating both feature access (spread type,
  history) and usage (daily draw quota).
- Stripe-based billing: Checkout for signup, Customer Portal for
  self-service management, webhooks to keep subscription state in sync.
- Anonymous (logged-out) usage keeps working on the Free tier, keyed by
  the existing `user_id` cookie, exactly as today, only quota-limited.

## Non-goals

- No mobile app / native billing (Apple/Google IAP).
- No team/org accounts — one subscription per user.
- No prorated multi-tier discounts, coupons, or trials in v1.
- No migration of Butterbase — it stays installed but unused.

## Data model (D1)

Add to the existing `inspire-readings` D1 database, alongside
`drawing_sessions` (unchanged):

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- uuid
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,       -- PBKDF2 (Web Crypto, Workers-safe)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tier TEXT NOT NULL DEFAULT 'free',        -- free | basic | pro
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',    -- active | past_due | canceled
  current_period_end DATETIME
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,     -- user id, or anon cookie value for guests
  date TEXT NOT NULL,        -- YYYY-MM-DD (UTC)
  draw_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
```

`drawing_sessions.user_id` already exists and continues to be populated
from either the authenticated user id or the anonymous cookie id.

## Tiers

| Tier  | Login required | Spreads             | Daily draws | History |
|-------|-----------------|----------------------|-------------|---------|
| Free  | No              | Single card only     | 3           | No      |
| Basic | Yes (paid)      | Single, 3-card        | 20          | Yes     |
| Pro   | Yes (paid)      | Single, 3-card, Celtic Cross | Unlimited | Yes |

Anonymous (logged-out) users are always Free tier, keyed by the existing
`user_id` cookie. Quota and gating logic treat a missing subscription row
as Free.

## Auth

Astro API routes under `src/pages/api/auth/`:

- `POST /api/auth/signup` — email + password, PBKDF2 hash via Web Crypto
  (`crypto.subtle`, Workers-compatible — no native bcrypt), inserts
  `users` row + a `subscriptions` row defaulted to `tier='free'`.
- `POST /api/auth/login` — verifies hash, issues a signed session cookie
  (HMAC-signed `user_id` + expiry, verified in middleware; no server-side
  session store needed).
- `POST /api/auth/logout` — clears the session cookie.

Once logged in, the session cookie replaces the anonymous `user_id`
cookie as the identity used for quota, history, and Stripe lookups. On
first login, any anonymous `drawing_sessions`/`usage_daily` rows under
the old anonymous id are left as-is (not merged) — out of scope for v1.

## Billing (Stripe)

- `POST /api/stripe/checkout` — creates a Stripe Checkout Session for
  the selected tier (Basic or Pro price id), `client_reference_id` set
  to the logged-in `user_id`, redirects to Stripe-hosted checkout.
- `POST /api/stripe/webhook` — verifies Stripe signature, handles:
  - `checkout.session.completed` → upsert `subscriptions` with
    `stripe_customer_id`, `stripe_subscription_id`, `tier`, `status='active'`.
  - `customer.subscription.updated` → sync `tier`/`status`/`current_period_end`.
  - `customer.subscription.deleted` → set `tier='free'`, `status='canceled'`.
- `POST /api/stripe/portal` — creates a Stripe Customer Portal session
  for the logged-in user's `stripe_customer_id`, for self-service
  cancel/upgrade/payment-method changes.
- Stripe secret key and webhook signing secret stored as Cloudflare
  Worker secrets (`wrangler secret put`), not in `wrangler.jsonc`.

## Enforcement

New `src/lib/entitlements.ts`:

- `getTier(userId): Promise<'free'|'basic'|'pro'>` — reads `subscriptions`,
  defaults to `'free'` if no row or `status != 'active'`.
- `getTodayUsage(userId): Promise<number>` — reads `usage_daily` for
  today's UTC date.
- `canDraw(userId, spreadKey): Promise<{ok: boolean, reason?: 'quota'|'spread_locked'}>`
  — checks tier's spread allowlist and remaining quota.
- `recordDraw(userId): Promise<void>` — upserts `usage_daily`, incrementing
  `draw_count`.

`src/pages/index.astro` calls `canDraw` before drawing; on rejection,
renders an inline upsell message instead of the reading (no redirect).
`recordDraw` is called alongside the existing `logReading` call.

The spread picker UI (`.spread-option` in `index.astro`) marks
tier-locked spreads as disabled with a small "Pro" / "Basic" badge and a
link to `/pricing`, rather than hiding them — this is a upsell surface.

## New pages

- `src/pages/signup.astro`, `src/pages/login.astro` — plain forms
  posting to the auth API routes above, following existing Astro
  page/form conventions (see `index.astro`).
- `src/pages/pricing.astro` — static tier comparison, buttons post to
  `/api/stripe/checkout`.
- `src/pages/account.astro` — shows current tier, usage today, link to
  `/api/stripe/portal`, logout.
- `src/pages/history/index.astro` — gated to Basic/Pro; lists the
  logged-in user's `drawing_sessions`, newest first.

## Error handling

- Auth: generic "invalid email or password" on login failure (no
  user-enumeration); signup rejects duplicate email with a clear message.
- Stripe webhook: verify signature, return 400 on failure; unknown event
  types are ignored (200) per Stripe's recommended pattern.
- Quota/spread rejection is not an error — it's a normal, expected
  response rendered as an upsell prompt.

## Testing

- Unit tests for `entitlements.ts` (tier defaults, quota boundary,
  spread allowlist per tier) — pure functions given a fake D1-like
  interface.
- Manual E2E per project convention (`run` skill / dev server): signup →
  hit Free quota → see upsell → Stripe test-mode checkout → confirm
  tier upgrade via webhook → confirm quota/spread unlocked → Customer
  Portal cancel → confirm downgrade to Free on next webhook.

## Open items deferred to implementation plan

- Exact PBKDF2 iteration count / cookie-signing key management
  (Worker secret).
- Whether `usage_daily` cleanup/TTL is needed (D1 storage growth) —
  likely a scheduled Worker cron to prune rows older than N days.
