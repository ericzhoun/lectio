# Registration perks (2026-08-29)

Goal: convert anonymous visitors into registered accounts by making the free tier strictly better after signup.

## Perks

| Visitor state | Single draws/day | 3-card spread | Celtic Cross (10 cards) |
| --- | --- | --- | --- |
| Anonymous (cookie) | 3 | locked → signup CTA | locked → signup CTA |
| Registered (free) | 6 | trial credits ×3 | trial credits ×1 |
| Basic | 20 | included | locked |
| Pro | unlimited | included | included |

## Design

- `src/lib/credits.ts` (new) — `welcome_credits` D1 table (`user_id` PK, `credit_3card`, `credit_celtic`), created lazily with `CREATE TABLE IF NOT EXISTS`. Grant is idempotent (`ON CONFLICT DO NOTHING`), so credits are strictly one-time per account.
- Grant points: `createUser` (email signup) and `upsertGoogleUser` (new Google accounts only). `canDraw` also lazy-grants for signed-in users, which backfills accounts created before this feature.
- `entitlements.ts`: daily quota is now registered-aware (`ANON_DAILY_DRAWS = 3`, `REGISTERED_DAILY_DRAWS = 6`; `QUOTA` keeps paid tiers unchanged). Free-tier multi-card draws are gated by credit balance, returning a new `no_credits` reason. Credit draws do **not** consume the daily quota, and vice versa.
- `recordDraw(userId, spreadKey, registered)` consumes one credit for registered free-tier multi-card draws; everything else increments the daily counter as before.
- UI: homepage shows a live quota line and (for anonymous users) a registration-perk banner; registered free users see remaining trial counts as gold badges on the spread cards and can click through to draw. Locked spreads route anonymous users to `/signup` and credit-exhausted users to `/pricing`. Signup/pricing/account pages advertise the perks.

## Tuning

Credit amounts live in one place: `WELCOME_CREDITS` in `src/lib/credits.ts` (currently `3card: 3`, `celtic_cross: 1`).

## Verification

- `npm test` — 53 tests pass, including new `credits.test.ts` and a rewritten `entitlements.test.ts` covering both visitor states.
- `npx astro check` — clean (also fixed 7 pre-existing test-helper type errors).
- `npm run build` — succeeds.
- Smoke-tested the built worker under `wrangler dev`: anonymous homepage shows 3/day + signup CTA; fresh signup → account page shows 6/day quota and granted credits; homepage shows `Trial ×3 / ×1` badges with multi-card spreads unlocked.
