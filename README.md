# Tarot Reading Web Application

An Astro (SSR, Node adapter) web application for Tarot card reading and interpretation using OpenAI's GPT models.

## Requirements

- Node.js 22.12+
- OpenAI API key

## Local development

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

3. Run the dev server:
```bash
npm run dev
```

## Production

```bash
npm run build
node ./dist/server/entry.mjs
```

The server listens on `PORT` (default `4321`) and `HOST` (default `0.0.0.0`).

### Environment Variables

- `OPENAI_API_KEY`: your OpenAI API key
- `TAROT_DB_PATH`: optional override for the SQLite reading-log path (default: `tarot.db` in the project root)

## Project structure

- `src/lib/tarot.ts` — deck data, spreads (single / three-card / Celtic Cross), draw logic, card library helpers
- `src/lib/openai.ts` — LLM interpretation + follow-up question generation
- `src/lib/db.ts` — SQLite reading log (better-sqlite3)
- `src/pages/index.astro` — the reading flow (question, spread picker, results)
- `src/pages/library/` — the 78-card browsable library
- `public/images/` — Rider-Waite (韦特) card images, WebP

## Features

- Draw Tarot cards with named spreads: single card, three-card (past/present/future), Celtic Cross
- **Draw and read before signing up**: anonymous visitors pick cards from a visual fan (3-card or 10-card Celtic Cross) or flip open the Bible — the Bible flip renders a real Bible page with the drawn verses highlighted inside their chapters (neighbouring verses included, WEB + 和合本, public domain). The question-based reading unlocks via the 解经/Interpret button: anonymous visitors get a registration prompt on click, registered ones generate the reading (spending a trial credit). Works with email and Google sign-in
- **Bible verse readings**: draw random scripture verses (single, three, or ten) in place of tarot cards, with the same spread positions (past/present/future for 3 verses; Celtic Cross positions for 10). 78-verse deck (CUV 中文和合本 + World English Bible, both public domain) with AI reflections per verse; switch via the Tarot / Bible Verses mode tabs on the home page (`?mode=bible` deep-links straight to Bible mode)
- AI-powered per-card and overall interpretations, in Chinese or English
- Support for reversed cards
- Browsable 78-card library with upright/reversed meanings
- Registration perks: registered free users get 6 single draws/day (anonymous: 3) plus one-time trial credits for the 3-card (×3) and Celtic Cross (×1) spreads — Bible verse readings share the same quotas and tier gates. Anonymous visitors can draw multi-card spreads (tarot or Bible) without an account; registering reveals the reading and consumes the matching trial credit. Details: `docs/2026-08-31-draw-to-reveal.md`.
- **First month free**: monthly Basic/Pro subscriptions start with a 30-day Stripe free trial (payment method collected, nothing charged until the trial ends; full plan features during the trial; one trial per account). Details: `docs/2026-09-01-first-month-free-trial.md`.

## Google sign-in

Login and signup pages support Google OAuth alongside email/password. A Google sign-in with a verified email matching an existing password account links to that account; a new email registers a new account.

Setup, required secrets, D1 schema, and rollback: see `docs/google-login-deployment.md`. Verification evidence: see `docs/google-login-run-check-report.md`.

## Authentication

- Email & password (existing) and **Google sign-in** (added 2026-08).
- Google OAuth flow: `/api/auth/google/start` -> `/api/auth/google/callback`, session via signed `session` cookie.
- Requires env vars `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (see `.dev.vars.example` / `docs/google-login-deployment.md`); until set, the Google button shows a graceful "not configured" message.
- User records live in D1 `users` (`google_id`, `name`, `avatar_url`, `created_at`, `last_login_at`); Google sign-in with an existing verified email links to that account (no duplicates).
- Docs: `docs/google-login-deployment.md` (deploy/rollback), `docs/google-login-run-check-report.md` (verification results).
