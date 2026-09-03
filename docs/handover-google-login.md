# HANDOVER — Google Sign-in for Inspire (status as of 2026-08-27 21:30 PDT)

Handover from fan (OpenClaw agent) → Claude. Goal id `c40bbec3-a499-46c4-b3d2-d0dafa4a378c`, mode `production_ready`.

## 0. One-line status

Implementation and automated verification are **complete and committed** (`9fb5675` on `main`); E2E smoke test **12/12 passed**, unit tests **43/43 passed**, build + `wrangler deploy --dry-run` pass. Remaining: email-link E2E run, D1 evidence queries, run/check report + deployment docs (md+HTML), final acceptance self-check.

## 1. What was built (all in commit `9fb5675`)

| Area | Files | Notes |
|------|-------|-------|
| OAuth lib | `src/lib/google.ts` | State gen (24B base64url), constant-time compare, auth URL builder, code→token exchange, userinfo fetch. Endpoint URLs overridable via `GOOGLE_AUTH_URL` / `GOOGLE_TOKEN_URL` / `GOOGLE_USERINFO_URL` (dev/mock only; default = real Google) |
| User store | `src/lib/users.ts` | `users` table + `google_id` (UNIQUE idx), `name`, `avatar_url`, `last_login_at`; idempotent ALTER migrations for pre-existing DBs; `upsertGoogleUser` (match by google_id → link by verified email → insert; race-safe), `recordLogin`, `getUserById/getUserByEmail/listUsers` (audit) |
| Routes | `src/pages/api/auth/google/start.ts`, `callback.ts` | start: state cookie (httpOnly, Path=/api/auth/google/callback, 10 min) + redirect to Google. callback: state validation (constant-time), code exchange, `email_verified` required, upsert, HMAC session cookie, redirect `/account`; friendly error codes: `cancelled` / `invalid_state` / `oauth_failed` / `config` |
| Frontend | `login.astro`, `signup.astro`, `account.astro`, `Layout.astro`, `global.css` | Google button (SVG, preset-11 whitespace styling), bilingual error banners, account profile card (avatar/name/email/badge/plan/member-since/last-login), session-aware nav (Log in ↔ Account) |
| Config | `src/env.d.ts`, `.dev.vars.example` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` + optional endpoint overrides |
| Tests | `src/lib/__tests__/google.test.ts` (13), `users-google.test.ts` (8), `helpers/d1-memory.ts` | In-memory D1 shim over `node:sqlite` → real SQL coverage: duplicate safety, email linking, concurrent-registration race, audit queries |
| E2E harness | `scripts/mock-google-server.mjs` (:9000), `e2e-google-login.mjs`, `e2e-google-link.mjs`, `inspect-d1.mjs` | Mock IdP with deny / fail-mode / profile-switch controls; driver asserts full flow + all error paths |

## 2. Verification evidence so far

- `npm test` → **43/43 passed** (21 new).
- `npm run build` → OK. `npx wrangler deploy --dry-run` → OK (note: root `wrangler.jsonc` needs no `main`; adapter generates `dist/server/wrangler.json`).
- E2E against `wrangler dev` (:8787) + mock IdP with a **fresh local D1**: **12/12 steps passed** — log at `.e2e/e2e-google-login.log`. Covered: Google entry on login+signup, start redirect (state + cookie), first registration → `/account?lang=zh&welcome=1`, profile rendered on account page, logout (CSRF-safe) + nav switch to "Log in", second sign-in → no welcome (no duplicate account), cancel → friendly message, forged state → `invalid_state`, missing code → `oauth_failed`, token-endpoint 500 → `oauth_failed`, unverified email → rejected (no record created).
- Local D1 reset before that run, so first-registration and duplicate-free second sign-in are proven on a clean DB.

## 3. Remaining work (in order)

1. **Run the link E2E**: start mock + `wrangler dev`, then `node scripts/e2e-google-link.mjs http://localhost:8787 http://127.0.0.1:9000`. It signs up `link.test@gmail.com` via the password form, then signs in with Google using the same verified email (sub `google-link-777`) — assert final URL `/account`, then query D1: exactly 1 row, `google_id='google-link-777'`, `password_hash` unchanged.
2. **D1 evidence queries** for the report: `npx wrangler d1 execute inspire-readings --local --command "SELECT id,email,google_id,name,created_at,last_login_at FROM users"` — show complete fields, count=1 for the test Google user across 2 sign-ins, `last_login_at` > `created_at`.
3. **Docs**: run/check report (md + HTML) itemizing the 8 acceptance criteria with the evidence above; deployment & handover doc (md + HTML) — env vars, Google Cloud Console callback setup, D1 init (auto-migration + manual SQL alternative), deploy steps, rollback (git revert + redeploy; new columns are additive/backward-compatible). README: add Google login section.
4. **Final acceptance self-check** vs the 8 Goal-Brief criteria → `update_goal complete`.
5. Cleanup (minor): add `.e2e/` to `.gitignore`; local `.dev.vars` stays untracked (verify).

## 4. How to reproduce the E2E locally (exact steps)

```powershell
cd D:\workplace\inspire
# terminal 1 — mock Google IdP
node scripts/mock-google-server.mjs            # :9000
# terminal 2 — app (build first if dist/ is stale)
npm run build
npx wrangler dev --port 8787
# terminal 3 — driver
node scripts/e2e-google-login.mjs http://localhost:8787 http://127.0.0.1:9000
node scripts/e2e-google-link.mjs  http://localhost:8787 http://127.0.0.1:9000
```

Required local `.dev.vars` (gitignored; already present on this machine):
```
SESSION_SECRET=<any string>
OPENAI_API_KEY=sk-dummy            # homepage 500s without it (module-level OpenAI client)
GOOGLE_CLIENT_ID=mock-client-id
GOOGLE_CLIENT_SECRET=mock-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
GOOGLE_AUTH_URL=http://127.0.0.1:9000/auth
GOOGLE_TOKEN_URL=http://127.0.0.1:9000/token
GOOGLE_USERINFO_URL=http://127.0.0.1:9000/userinfo
```

Mock IdP controls: `GET /auth?deny=1` simulates cancel; `POST /__toggle-fail` toggles 500s on token/userinfo (simulates Google/network outage); `POST /__set-user` with JSON swaps the test profile (`{}` resets; default user: sub `google-1111111111111111`, `test.google@gmail.com`, verified).

## 5. Environment gotchas (cost hours — read before debugging)

- **Zombie processes**: killing an exec session on Windows does NOT kill the `npx → node wrangler → workerd` tree. Stale workerd kept serving old builds on :8787 and caused misleading failures. Always clean up by PID: `Get-Process workerd | Stop-Process -Force` + kill node processes whose CommandLine matches `wrangler`, then confirm `Get-NetTCPConnection -LocalPort 8787 -State Listen` is empty before testing.
- **Astro CSRF**: all POST routes reject requests without an `Origin` header ("Cross-site POST form submissions are forbidden"). curl/scripts must send `Origin: http://localhost:8787`. Browsers are unaffected (pre-existing protection, kept).
- **Use `127.0.0.1`, not `localhost`**, for the mock endpoint URLs in `.dev.vars` (workerd outbound fetch quirk on this machine).
- **Reset local D1**: stop workerd first, then delete `.wrangler/state/v3/d1`. Query live with `npx wrangler d1 execute inspire-readings --local --command "..."`.
- wrangler is logged in (OAuth, joechenst@gmail.com) — `--remote` commands touch the real D1; don't run destructive queries remotely.

## 6. Design decisions (for the record)

- **Account linking by verified Google email**: a Google sign-in with an email matching an existing password account links `google_id` onto that row (no duplicate, no data loss). Requires `email_verified`; unverified → rejected with no record.
- **Google-only accounts** get `password_hash = ''` — inert (PBKDF2 verify always false), keeps `NOT NULL` compat with pre-existing DBs, no risky table rebuild.
- **Sessions**: existing stateless HMAC cookie scheme (`SESSION_SECRET`) reused for Google logins; logout deletes the cookie.
- **CSRF**: OAuth `state` in httpOnly cookie scoped to the callback path, 10-min TTL, constant-time compare, deleted after use.
- **Scope guards**: existing email/password auth, Stripe, entitlements untouched; visitors can still browse without signing in.

## 7. Production deploy checklist (to fold into the deployment doc)

1. Google Cloud Console → OAuth consent screen + Web OAuth client; Authorized redirect URI = `https://<domain>/api/auth/google/callback`.
2. `npx wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (set `GOOGLE_REDIRECT_URI` too if the origin isn't canonical).
3. D1: no manual migration needed (`ensureTable` alters idempotently on first request); optional manual SQL provided in docs.
4. `npm run build && npx wrangler deploy`. Verify `/api/auth/google/start` redirect + callback with a real Google account.
5. Rollback: `git revert` to previous deploy commit and redeploy; additive columns keep the previous worker version compatible.
