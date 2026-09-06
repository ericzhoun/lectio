# Lectio Mobile Web Usability — Design

- **Date:** 2026-09-06
- **Status:** Approved direction (brainstorm 2026-09-06); awaiting spec review
- **Scope decision:** Approach **B — Thumb-first shell + ritual mode**, covering items **M-01…M-07**
- **Companion artifacts:** `.lavish/lectio-mobile-usability.html` (mockups, this design's source), `.lavish/lectio-ux-redesign.html` (site-wide UX proposal; this spec is decoupled from it)

## 1 · Goal

A returning reader on a phone (iOS Safari or Android Chrome, 360–430 px wide) completes the
six-step `/today` practice without fighting the interface. The anonymous first-draw funnel on
`/` must not regress.

Success criteria:

1. On a 375×667 viewport, step content starts within one screen-height tap of opening `/today/<step>` — no wrapped link-wall above it.
2. The step's primary action (Begin / Continue) is always at the same physical place: bottom of the viewport, above the home indicator.
3. Lighthouse PWA installability passes (manifest + icons + theme-color); "Add to Home Screen" launches standalone with a correct status-bar color in both themes.
4. No tap target below 44×44 px and no focusable input below 16 px font on mobile widths.
5. Every new user-facing string exists in English and Chinese.

## 2 · Non-goals

- **No service worker / offline mode.** That is approach C, deferred until B proves the habit.
- **No auth-card restructure.** `ab.ts` is running `signup_cta_copy` (control vs invitation) in `LoginForm.astro`; this spec touches auth inputs only for size (M-05), never structure or copy.
- **No desktop redesign.** The desktop shell stays as-is; the new mobile shell is built as a component the later site-wide redesign (UX-01) can adopt.
- **No changes to entitlements, layout keys (`single` / `3card` / `celtic_cross`), quotas, credits, or the pending-draw / reveal flow.** This spec is presentation-only.
- **No new analytics schema.** Existing `data-event` attributes are preserved; at most one additive event (`nav_sheet_open`) may be added later, out of scope here.

## 3 · Current state (verified)

| Finding | Evidence |
| --- | --- |
| 9-link right-aligned nav renders on every page incl. steps; no mobile restructuring | `src/layouts/Layout.astro:99-113`; no `@media` for `.top-nav` in `src/styles/global.css` |
| Step continue action (`.advance`) floats in content flow | `src/pages/today/[step].astro` |
| No manifest, no `theme-color`, no `apple-touch-icon` | `public/` contains only favicon/logo; head has neither |
| Overlays ignore safe areas; only assistant panel uses `dvh` (70dvh) | `src/components/AssistantWidget.astro:338,377`; loader `height: 100%` at `global.css:149-161` |
| Assistant bubble `position: fixed` at `z-index: 9999` can cover CTA/inputs | `AssistantWidget.astro:338` |
| Sub-44px targets (nav links, listen pills, A−/A/A+), 15px auth inputs (iOS zoom) | `global.css:58-64, 233-237`; `[step].astro:511-521` |
| Full-screen blocking loader during AI reflection | `global.css:149-161`, `z-index: 1000` |

What already works and must be kept: `today/[step].astro` scoped styles (rem padding, reading-scale text controls), `prefers-reduced-motion` coverage for Bible animations, theme pre-paint script (`Layout.astro:42-54`), `DailyProgress.astro` step state (done/current/locked with links), assistant panel `dvh` sizing.

## 4 · Design

### 4.1 M-01 — Thumb nav bar + sheet (mobile shell)

New component `src/components/MobileNav.astro`, rendered by `Layout.astro` (its bar/sheet are shown **only at widths ≤ 760 px** via CSS). The existing `.top-nav` stays in the DOM on all pages; below 760 px it is hidden **only under an `html.js-nav` class** that the MobileNav toggle script adds at runtime — so without JavaScript, the current link list remains the working fallback. Desktop keeps today's `.top-nav` until the site-wide redesign lands, at which point it adopts this component.

- **Bar:** `position: sticky; top: 0`, 48 px tall, `var(--panel)` background with slight translucency + `backdrop-filter: blur(8px)`, bottom hairline `var(--panel-border)`. Left: brand `✦ Lectio` (link `/`). Right: `Today` gold pill (link `/today`, keeps the existing `data-event="cta_click"` nav_today attrs) and a ☰ button.
- **Sheet:** full-screen fixed panel (below the bar) built from `<button aria-expanded>` + hidden-state class (no JS dependency beyond a 3-line toggle; page is usable without it). Rows are ≥ 48 px tall, full-width, separated by hairlines: Verse Library, Approach, Pricing, Privacy, 中文 / English (reuses `langSwitchHref`), Sign in / Account (session-aware, same logic as `Layout.astro:101-105`). All links stay in the DOM so crawlers see them (no `display: none` on the source links — the sheet is the mobile presentation of the same links via CSS at mobile widths; desktop keeps its own markup).
- **Strings:** all row labels + "Menu" / "Close" defined in the component's en/zh copy object, following the `lang === 'zh' ? … : …` convention used in `Layout.astro`.
- The bar and sheet respect `env(safe-area-inset-top)` via `padding-top: max(0px, env(safe-area-inset-top))`; `<meta name="viewport">` gains `viewport-fit=cover`.

### 4.2 M-02 — Ritual mode inside `/today` steps

Applies to `src/pages/today/[step].astro` and `src/pages/today/amen.astro` at all widths (the practice deserves the calm treatment on desktop too), implemented mobile-first.

- **Chrome opt-out:** `Layout.astro` accepts a new optional prop `chrome="minimal"`. When set, it renders neither `.top-nav` nor `MobileNav`; the page renders its own header. Default behavior unchanged for every other page.
- **Structure** (full-height flex column, `min-height: 100dvh`):
  1. *Step header:* restyled `DailyProgress` as six dots (done = gold, current = outlined, locked = dim) + "step N of 6" label (en/zh) + `✕` exit → `/today` (anonymous: existing anon-progress cookie keeps their place — no logic change, the link is just a navigation).
  2. *Scrollable middle:* existing step content unchanged (silence timer, reading with text-size controls, writing textarea, prior-words quotes, AI reply + listen).
  3. *Action bar:* `position: sticky; bottom: 0` inside the flex column; the step's `.advance` link / submit button moves here — full-width, 52 px tall, gold, 14 px border-radius, `padding-bottom: max(12px, env(safe-area-inset-bottom))`. The disabled/"write something first" error state styling is preserved.
- **Audio:** listen pills remain inline (no mini-player — that belongs to approach C).
- **Amen page:** same frame; its action is "Return home" / CTA.
- Progress dots reuse `DailyProgress` props (`reached`, `current`) — no new state.

### 4.3 M-03 — PWA-lite

- `public/manifest.webmanifest`: `name: "Lectio"`, `short_name: "Lectio"`, `description` from the existing Organization schema, `start_url: "/today"`, `display: "standalone"`, `background_color: "#0e1220"`, `theme_color: "#0e1220"`, icons: `logo.webp` is already 512×512 — declare it as the 512 icon (`type: image/webp`) **and** add a generated 192×192 `logo-192.png` — a one-off conversion committed to `public/` (e.g. a `scripts/make-icons.mjs` run once with `sharp` as a devDependency, or any offline image tool); `sharp` must not become a runtime dependency.
- `Layout.astro` head: `<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/logo-192.png">`, and one `<meta name="theme-color" id="theme-color-meta">` (dark default), which the
existing pre-paint theme script sets to the *resolved* theme — a script cannot
override media-scoped metas, and the resolved theme must win over the OS preference.
- Cloudflare `_headers`: cache `/manifest.webmanifest` and `/logo-192.png` with a moderate TTL (e.g. `max-age=86400`) — matching the existing `_headers` style.
- No service worker in this scope.

### 4.4 M-04 — Safe areas + `dvh` everywhere overlays exist

- `.loading-overlay` (or its M-07 replacement, below): `height: 100dvh` with fallback `100vh`, `padding: env(safe-area-inset-*)`.
- `.gate-modal-backdrop` / `.gate-modal`: same treatment; modal gains `margin-bottom: max(18px, env(safe-area-inset-bottom))`.
- `AssistantWidget`: launcher offset becomes `bottom: calc(18px + env(safe-area-inset-bottom))`; panel `max-height: 70dvh` stays.
- All new fixed/sticky elements declare `env(safe-area-inset-*)`; browsers without support fall back to the plain value via `max()`.

### 4.5 M-05 — Touch targets + input zoom

Sweep (mobile widths ≤ 760 px, but target sizes apply everywhere where harmless):

- `.top-nav a` / MobileNav rows: min-height 44 px (bar) / 48 px (sheet rows).
- `.listen` buttons and A−/A/A+ controls in `[step].astro`: min 44×44 px hit area (visual size may stay small; extend via padding/transparent border).
- `.follow-up-question`, `.filters a`, `.billing-toggle-btn`, `.gate-modal-later`: padding bumped to ≥ 44 px total height on mobile.
- All `<input>` / `<textarea>`: font-size ≥ 16 px (auth-card 15 px → 16 px; `.question-input` already 16 px).

### 4.6 M-06 — Assistant widget mobile behavior

- Z-order contract (top wins): loader 1000 → gate modal 100 → **assistant 60** → sheet/bar 50. The assistant never sits above modals or the action bar.
- On `/today` writing steps (meditatio, oratio): the launcher collapses to a small tab (icon-only, 44 px) pinned above the safe-area, and the panel opens *above* the action bar (`bottom: calc(72px + env(safe-area-inset-bottom))`) so it never covers Continue.
- No assistant logic changes — presentation and geometry only.

### 4.7 M-07 — Inline shimmer loader (replaces the full-screen overlay)

On `src/pages/index.astro`'s result render path, the blocking `.loading-overlay` is replaced by an inline shimmer block styled after the existing `.teaser-line` reveal-gate language: the received verse (parchment page) stays fully visible above, and a 3-line shimmer + "Receiving the reflection…" hint (en/zh) renders inside the interpretation panel area while the POST round-trips. Because the current flow is a full-page POST (not fetch), the shimmer is shown by a small inline script on `submit` (`document.documentElement.classList.add('is-waiting')`) and CSS renders the shimmer placeholder in the results area; the overlay element is deleted. Reduced-motion: shimmer animation disabled, static bars shown (matches the existing `prefers-reduced-motion` pattern).

## 5 · Data flow

No new state, endpoints, or DB changes. Sheet open/close and ritual-mode layout are client-side CSS/JS. The only server-visible changes are new static assets (`manifest.webmanifest`, `logo-192.png`) and head tags. Language switching and session-aware nav reuse existing helpers (`langSwitchHref`, `verifySessionToken` already computed in `Layout.astro`).

## 6 · Error handling & compatibility

- No-JS: the sheet toggle needs JS; without JS the bar still exposes Today + brand (the two primary links), and `.top-nav` remains in the DOM at mobile widths as the no-JS fallback (hidden only when the sheet script runs — progressive enhancement).
- `dvh` / `env()`: used inside `max()` / with `vh` fallbacks; older browsers get today's behavior.
- Manifest errors or missing icons degrade to today's behavior (bookmark install).
- Theme-color script failures are swallowed by the same `try/catch` pattern as the existing theme script.

## 7 · Testing

- `npm test` (vitest) — no lib changes expected; suite must stay green (guards entitlements/session logic we don't touch).
- `npm run build` + `npx wrangler dev` manual matrix: iPhone SE 375px, iPhone 15 Pro 393px, Android 360px; dark + light; with/without "Add to Home Screen"; reduced-motion on; en + zh.
- Checklist per page: `/`, `/today/silencio` … `/today/amen`, `/library`, `/pricing`, `/login`, `/account`.
- Verify: A/B `signup_cta_copy` still renders both variants (auth card untouched); `cta_click` nav events still fire from the Today pill; Bible opening animation unchanged; loader no longer covers the viewport during reflection generation.
- Lighthouse mobile: PWA installable, no horizontal overflow at 320 px.

## 8 · Files touched

| File | Change |
| --- | --- |
| `src/components/MobileNav.astro` | **new** — thumb bar + sheet |
| `src/layouts/Layout.astro` | viewport-fit, manifest/theme-color/apple-touch-icon links, render `MobileNav`, `chrome="minimal"` prop, theme-color sync in existing script |
| `src/styles/global.css` | media queries for shell swap at 760 px, safe-area/dvh fixes, touch-target sweep |
| `src/pages/today/[step].astro` | ritual-mode frame (header dots, sticky action bar), listen/A-controls hit areas |
| `src/pages/today/amen.astro` | same frame |
| `src/pages/index.astro` | shimmer-on-submit loader replacement |
| `src/components/AssistantWidget.astro` | z-index, safe-area offset, writing-step geometry |
| `public/manifest.webmanifest`, `public/logo-192.png` | **new** static assets |
| `public/_headers` | cache rules for the two new assets |

## 9 · Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| `signup_cta_copy` A/B invalidated | Auth card: size-only changes; no markup/order/copy changes; variant rendering in `LoginForm.astro` untouched |
| Entitlements keyed by layout keys | No change to `SPREADS`, `entitlements.ts`, cookie flows |
| SEO: nav links hidden in sheet | Sheet links remain in DOM (CSS presentation, not removal); canonical/hreflang untouched |
| iOS input zoom regressions | 16 px rule verified in manual matrix |
| Ritual mode hides orientation cues | Exit ✕ → `/today` + step dots preserve location; amen page returns home |

## 10 · Receipt for submitted scope

| ID | Item | Covered by |
| --- | --- | --- |
| M-01 | Thumb nav bar + full-screen sheet | §4.1 |
| M-02 | Ritual mode inside `/today` steps | §4.2 |
| M-03 | PWA-lite install primitives | §4.3 |
| M-04 | Safe areas + `dvh` for overlays | §4.4 |
| M-05 | 44px targets + 16px inputs | §4.5 |
| M-06 | Assistant widget mobile behavior | §4.6 |
| M-07 | Inline shimmer loader | §4.7 (shared with UX-03 of the site-wide proposal) |
