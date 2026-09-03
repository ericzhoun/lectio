# First month free trial (2026-09-01)

Goal: new subscribers try a paid plan before paying — monthly checkouts for
Basic and Pro start with a **30-day free trial** (the first month is free).
Stripe collects the payment method at checkout but charges nothing until the
trial ends; the subscriber keeps full plan features (quota, spreads) during
the trial and can cancel anytime from the customer portal.

## Scope decisions

- **Monthly billing only.** Annual plans keep their existing "save 40%"
  discount and are not double-discounted with a trial.
- **One trial per account.** The checkout endpoint grants the trial only when
  the account has never had a Stripe subscription. After cancellation the
  local `subscriptions` row keeps its `stripe_subscription_id` (the upsert
  uses `COALESCE`), which is what the guard checks. Same-account re-trials
  are blocked; trials across different accounts are out of scope.
- **No schema changes.** The existing `subscriptions` table stores the
  subscription `status`, which now may be `trialing`.

## Flow

1. **Checkout (`/api/stripe/checkout`)**: for `billing=monthly`, the endpoint
   looks up the account's existing subscription row; if it has no
   `stripe_subscription_id`, the Checkout Session is created with
   `subscription_data.trial_period_days = 30` (`FIRST_MONTH_TRIAL_DAYS` in
   `src/lib/stripe.ts`). Payment method collection stays at Stripe's default
   (required for trial checkouts).
2. **Webhook (`/api/stripe/webhook`)**: with a trial the subscription starts
   as `trialing`, and Stripe may deliver `customer.subscription.created`
   before `checkout.session.completed`. Two changes make the local row
   accurate regardless of event order:
   - `mapSubscriptionEvent` now also handles `customer.subscription.created`
     (same mapping as `updated`).
   - On `checkout.session.completed` the handler retrieves the subscription
     from Stripe and snapshots its real `status` and `current_period_end`
     (the trial end date) instead of assuming `active`.
3. **Entitlements (`resolveTier`)**: extracted into a pure
   `tierFromSubscription()` helper which treats both `active` and `trialing`
   as paid. Trial users get the full Basic/Pro experience from minute one;
   `past_due` / `unpaid` / `canceled` still fall back to free.
4. **Trial end**: Stripe fires `customer.subscription.updated` — status flips
   to `active` (payment captured) or `past_due` (card failed) and the row
   updates through the existing webhook path. No new webhook events needed.

## UI

- **Pricing page**: a "First month free / 首月免费" badge on both paid cards
  (monthly view only — the annual toggle swaps it for "Save 40%") plus a note
  line under the billing toggle: trial is free, cancel anytime, nothing is
  charged during the trial. Page meta description mentions the trial.
- **Account page**: a "Subscription status" row — trialing shows
  "First month free — billing starts {date}" (zh: 首月免费试用中 ·
  {date} 开始扣费), active shows the renewal date. The "Manage subscription"
  portal button is available during the trial for self-serve cancellation.

## Files

- `src/lib/stripe.ts` — `FIRST_MONTH_TRIAL_DAYS`, `PAID_SUBSCRIPTION_STATUSES`,
  `customer.subscription.created` mapping.
- `src/lib/entitlements.ts` — `tierFromSubscription()` (pure, tested);
  `resolveTier()` delegates to it.
- `src/pages/api/stripe/checkout.ts` — trial on monthly checkout, one-per-account guard.
- `src/pages/api/stripe/webhook.ts` — status/period snapshot on checkout completion.
- `src/pages/pricing.astro` + `src/styles/global.css` — trial badge, toggle
  behaviour, note line.
- `src/pages/account.astro` — subscription status row.
- Tests: `src/lib/__tests__/stripe.test.ts` (created event / trialing),
  `src/lib/__tests__/entitlements.test.ts` (`tierFromSubscription`).

## Verification

- `npm test` — 105 tests pass (13 files), including the new trialing/created
  mapping and `tierFromSubscription` cases.
- `npx astro check` — 0 errors, 0 warnings.
- `npm run build` — production build succeeds.
- Dev server: `/pricing?lang=en|zh` renders the badge + note on both paid
  cards; annual toggle switches badge visibility (client script updated).

## Known limitations

- Trials across multiple accounts (different emails) are not blocked; that
  needs Stripe customer history search, not local state.
- The trial length is a code constant (30 days), not an env var; change
  `FIRST_MONTH_TRIAL_DAYS` in `src/lib/stripe.ts` if the promo changes.
- Existing subscribers and portal-driven plan changes are unaffected: the
  trial only applies at Checkout creation time.
