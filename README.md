# Lectio

An Astro (SSR, Cloudflare Workers adapter) web application for **Lectio Divina** — slow, prayerful
scripture reading — with AI-assisted reflections from OpenAI's models.

Lectio is contemplative reading, not divination. Verses arrive unchosen; the practice is to read
them, reflect on what catches, respond honestly, and rest.

## Requirements

- Node.js 22.12+
- OpenAI API key

## Local development

1. Install dependencies:
```bash
npm install
```

2. Copy `.dev.vars.example` to `.dev.vars` and fill in your values.

3. Run the dev server:
```bash
npm run dev
```

## Production

```bash
npm run build
npx wrangler deploy
```

Deploys the `lectio` Worker to `3livescapture.com`.

### Bindings and environment

Bindings live in `wrangler.jsonc`:

- `DB` — D1 database `lectio-readings` (reading log; tables self-create on first use)
- `SESSION` — KV namespace `lectio-session`
- `AI` — Workers AI, used by `/api/tts` for the open-source MeloTTS model that reads the daily
  passage aloud. The endpoint takes `?day=YYYY-MM-DD&lang=en|zh` and resolves the text itself, so it
  will only ever speak the lectionary; responses are cached, and a day is synthesized once for all
  readers. Readings longer than one model call are split at sentence boundaries and the MP3 parts
  joined, so a long gospel is read to the end rather than cut off

Vars in `wrangler.jsonc`: `GOOGLE_REDIRECT_URI` - pinned so `/api/auth/google/start` and
`/api/auth/google/callback` always send Google an identical `redirect_uri`; deriving it from the
request URL can differ by scheme and makes the token exchange fail.

Secrets (see `.dev.vars.example`): `OPENAI_API_KEY`, `SESSION_SECRET`, the `STRIPE_*` keys and
price ids, and the `GOOGLE_*` OAuth values. `SESSION_SECRET` is required - Google sign-in fails at
the last step without it.

## Project structure

- `src/lib/reading.ts` — languages, layouts (Daily Word / Lectio Divina / Deep Lectio), starter questions
- `src/lib/scripture.ts` — the 148-verse deck, draw + rebuild logic, chapter-context pages, verse library helpers
- `src/lib/bibleChapters.json` — chapter context text (WEB + 和合本, both public domain)
- `scripts/fetch-bible-context.mjs` — regenerates `bibleChapters.json` from api.getbible.net; run it
  after adding deck verses, then re-run `npm test`
- `src/lib/openai.ts` — LLM reflection + follow-up question generation
- `src/lib/db.ts` — D1 reading log
- `src/pages/index.astro` — the reading flow (question, layout picker, results)
- `src/pages/library/` — the browsable verse library

## Layouts

Layout keys are stable (`single` / `3card` / `celtic_cross`) because entitlements, quotas, and the
welcome-credit columns are keyed by them.

| Key | Verses | Name | Positions |
| --- | --- | --- | --- |
| `single` | 1 | Daily Word | The Word for Today |
| `3card` | 3 | Lectio Divina | Lectio · Read, Meditatio · Reflect, Oratio · Respond |
| `celtic_cross` | 10 | Deep Lectio | A ten-step contemplative path |

## Features

- **Receive a scripture reading** in one of three layouts, in Chinese or English, with an AI
  reflection per verse plus an overall reflection.
- **Read before signing up**: anonymous visitors open the Bible on a multi-verse layout and get a
  real Bible page with the received verses highlighted inside their chapters (neighbouring verses
  included, WEB + 和合本, both public domain). The question-based reflection unlocks via the
  Reflect button: anonymous visitors get a registration prompt on click, registered ones generate
  the reflection (spending a trial credit). Works with email and Google sign-in.
  Details: `docs/2026-08-31-draw-to-reveal.md`.
- **Verse library** — all 148 passages, filterable by testament, with both language texts and themes.
- **Registration perks**: registered free users get 6 Daily Word readings/day (anonymous: 3) plus
  one-time trial credits for Lectio Divina (×3) and Deep Lectio (×1).
- **First month free**: monthly Basic/Pro subscriptions start with a 30-day Stripe free trial
  (payment method collected, nothing charged until the trial ends; full plan features during the
  trial; one trial per account). Details: `docs/2026-09-01-first-month-free-trial.md`.

## Google sign-in

Login and signup pages support Google OAuth alongside email/password. A Google sign-in with a
verified email matching an existing password account links to that account; a new email registers a
new account.

Setup, required secrets, D1 schema, and rollback: see `docs/google-login-deployment.md`.
Verification evidence: see `docs/google-login-run-check-report.md`.

## Authentication

- Email & password, and **Google sign-in**.
- Google OAuth flow: `/api/auth/google/start` -> `/api/auth/google/callback`, session via signed
  `session` cookie.
- Requires env vars `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (see `.dev.vars.example`); until
  set, the Google button shows a graceful "not configured" message.
- User records live in D1 `users` (`google_id`, `name`, `avatar_url`, `created_at`,
  `last_login_at`); Google sign-in with an existing verified email links to that account.

## Listen (TTS)

Daily audio is generated with the open-source Chatterbox model (MIT) on a local GPU and committed
as static assets, so listening costs nothing at request time - free for everyone.

- **Step guidance + whole-session audio**: the twelve step prompts (6 steps x en/zh) live in
  `public/audio/steps/`, content-hashed. The Silencio page offers a guided-session player that
  reads all six steps and the passage aloud, with rests between.
- **Daily passage**: `public/audio/days/<lang>/<day>.mp3` for each day the batch has covered.
  `/api/tts?day=...&lang=...` serves the prebuilt clip when it exists and falls back to on-demand
  Workers AI (MeloTTS) when it does not, so every day of the lectionary is audible either way.
- **AI replies** (per reader, written in response to their words, so never prebuildable) can be
  spoken via `POST /api/reflection-tts { day, step }`. The endpoint only ever reads the reply text
  already stored in D1 for that reader - it never accepts request text.

Regenerate locally (requires the TTS toolbox venvs; see `scripts/tts/`). Two engines: the
default `chatterbox` (best cloning-style voice, ~2.6 min/clip on GPU) and `kokoro`
(hexgrad/Kokoro-82M, preset voices af_heart/zm_yunxi, ~1.3 s/clip on GPU):

    npm run tts:steps                  # the 12 guidance clips; skips clips whose text is unchanged
    npm run tts:passages -- --next 7   # a rolling window; resumable, skips days already on disk
    npm run tts:passages -- --all --yes --engine kokoro
                                       # the whole 1826-day table, future days first;
                                       # resumable - just rerun to continue an interrupted run

`run_tts_backlog.bat` runs the full-table command standalone (safe to stop and rerun anytime).
The manifest `src/lib/audioDays.json` also records which engine produced each clip.
