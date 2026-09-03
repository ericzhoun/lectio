# Draw-to-reveal: anonymous multi-card readings (2026-08-31)

Goal: let unregistered visitors experience multi-card spreads the way
tarot.com's daily reflection does — draw now, register only when they press
the interpret (解经/解读) button. Covers both modes: tarot (3-card and Celtic
Cross card fans) and Bible verses, which after the flip render as a "real
Bible page": the drawn verses embedded in their chapter with neighbouring
verses, ready to read for free.

## Flow

1. **Anonymous home page**: the 3-card and Celtic Cross spreads are unlocked
   for anonymous visitors. Tarot: selecting a multi-card spread reveals a
   "pick your cards" fan (24 face-down cards, reshuffle button) whose slot
   count matches the spread (3 or 10, Celtic slots numbered 1–10). Picks
   land in their position slots and flip face-up. Bible: selecting a
   multi-verse spread shows a "Flip open the Bible" panel — one flip draws
   the verses, no picking needed.
2. **POST /**: tarot picks are validated against a shuffled `deck_order`
   embedded in the form (the cards they pick are the cards they get; invalid
   payloads fall back to a random draw). Bible draws are random server-side.
   The drawn items are stored in an HMAC-signed `pending_draw` cookie (7-day
   TTL, same `SESSION_SECRET` as the session cookie, mode + spread + item
   identities). No interpretation is generated, no quota and no credit is
   spent at draw time.
3. **Locked view — read the Bible page for free**: tarot shows the cards
   (image, name, position, upright/reversed). Bible shows a paper-styled
   Bible page (`src/lib/bibleChapters.json` context data): each drawn verse
   embedded in its chapter with ±6 neighbouring verses, verse numbers,
   chapter headings in both languages, drawn verses highlighted with their
   position tags, and ellipsis markers where the window cuts the chapter.
   No registration prompt is shown automatically. Below the items sits the
   interpret bar with a single gold **解经 / Interpret** button.
4. **Interpret button (解经/解读)**: anonymous visitors — clicking opens the
   registration modal (signup/login CTAs + perks); nothing happens without
   the click. Registered visitors — the button is a form POST
   (`reveal_pending=1`) that runs the reveal: AI interpretation for the
   question, matching credit consumed, reading logged, cookie cleared.
   Auth endpoints (signup / login / Google callback) still redirect back to
   `/` when a `pending_draw` cookie is present, so after registering the
   visitor presses 解经 once more to reveal.
5. **Reveal (POST `reveal_pending=1`)**: entitlement is re-checked
   (`canDraw`), the drawn items are rebuilt server-side, the AI
   interpretation is generated for the visitor's question, one matching
   welcome credit is consumed (`recordDraw`: 3-card credit for 3-card,
   Celtic credit for Celtic Cross), the reading is logged to
   `drawing_sessions` (mode-aware), and the cookie is cleared. The full
   reading renders.

## Edge cases

- Reveal entitlement fails (`no_credits` / `quota` / `spread_locked`):
  drawn items are shown with a matching upsell (pricing for credits or a
  Pro-gated spread, come-back-tomorrow for quota); the cookie is kept so
  the reading can still be revealed later.
- Interpretation call fails (e.g. LLM outage): `retry` gate is shown, the
  cookie is kept, nothing is spent — a reload retries. (Note: the OpenAI
  client itself catches API errors and renders "Error generating
  interpretation" as the summary — pre-existing behavior shared with the
  normal POST path.)
- Corrupt/tampered/expired cookie or unknown card names / verse refs: cookie
  cleared, page renders normally. `rebuildDrawnCards` and
  `rebuildDrawnVerses` only accept identities from the real decks and never
  duplicate.
- Bible mode: anonymous multi-verse draws are gated the same way as tarot;
  the entitlement layer is mode-agnostic and `index.astro` picks the flow
  and copy by mode.

## Files

- `src/lib/pendingDraw.ts` (new) — signed cookie token + payload validation
  (mode-discriminated: tarot cards or Bible verse refs, 1–10 items).
- `src/lib/tarot.ts` — added `drawCardsFromNames`, `rebuildDrawnCards`,
  `sanitizeDeckOrder`, `sanitizePickedIndices`; per-card build logic shared.
- `src/lib/bible.ts` — added `rebuildDrawnVerses` (rebuild by English ref) and
  `buildBiblePages` (chapter-context pages: ref parsing, ±6-verse windows,
  drawn-range marking, draw-order pages, missing-chapter fallback).
- `src/lib/bibleChapters.json` (new, generated data) — full chapter text for
  every chapter referenced by the deck (70 chapters, WEB English + CUV 神版
  Chinese, both public domain, via api.getbible.net; "Yahweh" normalized to
  "the LORD" to match the deck's WEB rendering). Regenerate with
  `node scripts/fetch-bible-context.mjs`.
- `src/lib/entitlements.ts` — anonymous multi-card spreads (3card,
  celtic_cross) now return `{ ok: true, gated: true }` instead of
  `spread_locked`, for both tarot and Bible modes.
- `src/pages/index.astro` — fan UI (spread-aware slots) + Bible flip panel +
  bible-page pending view + button-driven reveal (POST `reveal_pending`) +
  interpret bar + modal-on-click + "Free draw" badges on multi-card spreads
  for anonymous visitors.
- `src/pages/api/auth/signup.ts`, `login.ts`, `google/callback.ts` —
  redirect to `/` when a pending draw exists.
- Tests: `pendingDraw.test.ts`, `tarot.test.ts`, `bible.test.ts` additions
  (incl. `buildBiblePages`), updated `entitlements.test.ts`.

## Verification

- `npm test` — 100 tests pass.
- `npx astro check` — 0 errors / 0 warnings.
- `npm run build` — succeeds.
- `wrangler dev` end-to-end smoke (with live OpenAI key):
  - Bible flip: anonymous draw → paper Bible page (3 chapter sections, ~11
    verses each, drawn verses highlighted with position tags, ellipsis
    markers), interpret button (no reveal form), modal in DOM but not shown,
    no interpretation; signup → 302 `/` → still pending with reveal form;
    POST `reveal_pending` → full verse reading (3 reflections + overall +
    follow-ups), 3-card credit 3 → 2, cookie cleared.
  - Tarot 3-card: anonymous picks → pending view with interpret button;
    signup → reveal form; POST → full reading (3 per-card texts + tags +
    overall), cookie cleared, clean home afterwards.
  - Tarot Celtic Cross (earlier round): 10-pick draw → reveal → 10 texts +
    tags, Celtic credit 1 → 0.
