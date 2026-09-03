# Web Assistant (Site Chat) - Design

Date: 2026-09-01
Status: Approved (brainstorming)

## Problem

Visitors have no way to ask questions on the site itself. A user mid-reading who
wonders "what does this reversed card mean for my question?" must leave the page;
prospective users cannot ask about plans, credits, or how the site works before
signing up. All AI today is one-shot interpretation (`src/lib/openai.ts`); there
is no conversational surface.

## Goals

1. A chat assistant is reachable on **every page** via a floating bubble (in
   `Layout.astro`), with a slide-up panel; no navigation required.
2. The assistant serves three roles, resolved per message by the model:
   **reading companion** (explains the drawn cards/verses on screen), **spiritual
   chat** (reflective conversation), and **site guide/support** (plans, credits,
   how-to — grounded in real site facts, never invented numbers).
3. Metered freemium, consistent with the draw-to-reveal pattern: anonymous
   visitors can chat immediately; the registration upsell appears only when they
   hit their cap.
4. Conversations are ephemeral (browser-side only). The server stores **no chat
   content** — only a daily counter per visitor.
5. The assistant sees useful context: current page URL/title and, when a reading
   is on screen, the drawn spread (cards/verses, positions, reversals, question).
6. Replies follow the site language (`lang` cookie), and the user's own language
   when they write in the other one.

## Non-Goals

- No server-side chat history, no saved conversations, no chat history UI (v1).
- No multiple named conversations / chat-app features.
- No billing-account actions through chat (no "cancel my subscription" — the
  assistant points to `/account` and `/pricing`).
- No new AI provider or model; uses the existing `openai` client
  (`gpt-5.4-nano`), same as interpretation.

## Design

### 1. Architecture overview

Per-message data flow:

1. `AssistantWidget.astro` (client script) sends
   `POST /api/assistant/chat` with `{ message, history, context }`.
   `history` = last 10 turns from `sessionStorage`; `context` = URL/title of the
   current page + reading context parsed from an `#inspire-reading-context` JSON
   script tag when present.
2. The API route resolves the visitor: signed `session` cookie → `u:<userId>`;
   otherwise anonymous `chat_anon` UUID cookie (created on first POST,
   `a:<uuid>`).
3. Quota check in D1 (`chat_usage_daily`, same UTC-day semantics as
   `usage_daily`). Over quota → structured `quota_exceeded` response; the widget
   shows the upsell card (Section 4).
4. Prompt assembly (`src/lib/assistant.ts`): persona + tri-mode rules + safety
   rails + grounding facts + context + history. Calls `gpt-5.4-nano` with
   streaming enabled.
5. The reply streams back to the widget (Cloudflare Workers support streaming
   `Response`s natively; Astro API routes return a `Response` directly).
6. On success the counter increments — failures never consume quota.

New files:

- `src/lib/assistant.ts` — prompt builder, context types, quota constants,
  grounding-fact builder.
- `src/lib/chatUsage.ts` — D1 counter (`chat_usage_daily`:
  `visitor_key TEXT, date TEXT, message_count INTEGER`, PK `(visitor_key, date)`,
  `CREATE TABLE IF NOT EXISTS` at first use like `usage.ts`).
- `src/pages/api/assistant/chat.ts` — POST, streaming, `prerender = false`.
- `src/pages/api/assistant/quota.ts` — GET, lazy-fetched only when the panel
  first opens (normal page views carry zero extra load).
- `src/components/AssistantWidget.astro` — bubble + panel + client script.
- Small edits: `Layout.astro` (one include), `index.astro` (render reading
  context JSON), `src/styles/global.css` (widget styles).

### 2. Quotas and identity

Constants in `assistant.ts` (single source, easy to tune):

```ts
export const ANON_DAILY_MESSAGES = 10;
export const REGISTERED_DAILY_MESSAGES = 30;
export const CHAT_QUOTA: Record<Tier, number> = { free: 30, basic: 100, pro: 100 };
```

- Anonymous identity: `chat_anon` cookie, UUID, `httpOnly`, `sameSite=lax`,
  `secure`, 1-year max-age, set on the visitor's first chat POST (not on page
  render — keeps `Layout.astro` free of side effects).
- Visitor key: `u:<userId>` or `a:<uuid>`; counter row keyed with today's UTC
  date. Anonymous limits are per-browser — the same trust level as the existing
  anonymous draw quotas; IP heuristics can be added later without schema change.
- Tier resolution reuses `resolveTier(userId)` from `entitlements.ts`.

### 3. The assistant's brain

One system prompt declaring three roles; the model picks per message:

- **Reading companion:** explains the drawn cards/verses, positions, reversals;
  suggests spreads; guides beginners. Hard rule: may only reference cards/verses
  present in the injected reading context — never invents draws. Bible questions
  cite only the drawn verses (same discipline as `generateBibleInterpretation`).
- **Spiritual chat:** warm, encouraging, non-judgmental reflection; no pushing
  the product.
- **Site guide:** answers how-to/plan/credit questions from injected grounding
  facts only: daily draw quotas, welcome credits, spread access per tier, first
  month free terms (built from the `entitlements.ts` constants), plan names and
  prices as displayed on `/pricing`. If an answer isn't covered, it says so and
  points to `/pricing`, `/account`, or `/privacy` instead of guessing.

Safety rails in the prompt: no medical/legal/financial directives; crisis
language gets a supportive reply pointing to professional help; deflects
off-brand tangents (politics, coding help) back to reflection or site topics.

Reading context: `index.astro` renders a
`<script type="application/json" id="inspire-reading-context">` blob when a
reading is displayed — spread name, question, per-card/verse
`{name/ref, position, reversed, interp}` for both tarot and bible modes. The
widget parses it per request; pages without it just omit the field.

### 4. Widget UX, i18n, error handling

- Bubble (✦, site palette) bottom-right; panel ~380px wide, `max-height: 70dvh`
  for mobile; no slide animation under `prefers-reduced-motion` (consistent with
  the bible-flip handling).
- First open: one-line greeting + 3 starter chips, chosen by page: `/` →
  "Draw a card" etc.; library → "What does The Tower mean?"; `/pricing` →
  "What's in Pro?". Chips are prefilled sends.
- Thread: bubble-style messages, typing indicator, streamed reply; last 20 turns
  in `sessionStorage`; sends include the last 10.
- Language: UI strings selected by the server-rendered `lang` prop (same
  `lang === 'zh' ? ... : ...` pattern as the nav); prompt instructs the model to
  reply in the user's language, defaulting to the site language.
- Errors: network/5xx → inline retry on the failed message; OpenAI failure →
  honest "I couldn't respond just now" (no fabricated content, **no quota
  consumed**); `quota_exceeded` → inline upsell card: anonymous → "Create a free
  account for 30/day" → `/signup?next=<current page>`; free tier → Pro pitch →
  `/pricing`. The thread stays visible when capped.
- Token discipline: `max_completion_tokens` ~500, history trimmed to 10 turns,
  compact grounding — per-message cost near existing interpretation calls.

### 5. Testing & rollout

Unit tests (vitest, existing suite, reusing `__tests__/helpers/d1-memory.ts`):

- `chatUsage.test.ts` — increment, UTC rollover, per-tier limits, anonymous vs
  registered keys.
- `assistant.test.ts` — prompt assembly: grounding facts match entitlements
  constants; reading context serialized/trimmed; language rule; safety lines
  present; history capping.
- API handler tests with a mocked OpenAI client — streaming happy path,
  `quota_exceeded` shape, failure path does not increment, anon cookie set on
  first message.

Manual run-check (like `docs/google-login-run-check-report.md`): anonymous chat
→ cap → upsell → signup → higher cap; reading-page context question; zh/en;
mobile viewport; reduced motion.

Rollout is additive: if anything misbehaves, removing the widget include from
`Layout.astro` disables the feature. No migration tooling — table creates on
first use.
