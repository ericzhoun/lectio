# Lectio Divina Web Application

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


## Features
— the Bible flip renders a real Bible page with the drawn verses highlighted inside their chapters (neighbouring verses included, WEB + 和合本, public domain). The question-based reading unlocks via the 解经/Interpret button: anonymous visitors get a registration prompt on click, registered ones generate the reading (spending a trial credit). Works with email and Google sign-in
- **Bible verse readings**: draw random scripture verses (single, three, or ten). 78-verse deck (CUV 中文和合本 + World English Bible, both public domain) with AI reflections per verse
- AI-powered per-card and overall interpretations, in Chinese or English
— Bible verse readings has the same quotas and tier gates. Anonymous visitors can pick multiple Bible verses without an account; registering reveals the reading and consumes the matching trial credit.
- **First month free**: monthly Basic/Pro subscriptions start with a 30-day Stripe free trial (payment method collected, nothing charged until the trial ends; full plan features during the trial; one trial per account).

## Google sign-in

Login and signup pages support Google OAuth alongside email/password. A Google sign-in with a verified email matching an existing password account links to that account; a new email registers a new account.

## Authentication

- Email & password (existing) and **Google sign-in** (added 2026-08).
- Google OAuth flow: `/api/auth/google/start` -> `/api/auth/google/callback`, session via signed `session` cookie.
- Requires env vars `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (see `.dev.vars.example` / `docs/google-login-deployment.md`); until set, the Google button shows a graceful "not configured" message.
- User records live in D1 `users` (`google_id`, `name`, `avatar_url`, `created_at`, `last_login_at`); Google sign-in with an existing verified email links to that account (no duplicates).
- Docs: `docs/google-login-deployment.md` (deploy/rollback), `docs/google-login-run-check-report.md` (verification results).
