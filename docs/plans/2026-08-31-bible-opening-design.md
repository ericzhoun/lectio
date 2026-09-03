# Bible Opening Reveal — Design

- **Date:** 2026-08-31
- **Status:** Validated. All decisions captured via Lavish review of the interactive preview (`docs/previews/bible-opening-preview.html`).
- **Scope:** Front-end only — `src/pages/index.astro` + `src/styles/global.css`. No API, DB, or entitlement changes. The freemium flow is untouched: anonymous visitors still see verses free; the registration gate on the interpret (解经) button stays as is.

## Problem

In Bible mode the highest-emotion moment — the book opening — doesn't exist. Today a static closed-book button submits instantly, a "please wait…" text covers the server round-trip, and the finished reading page simply appears after reload.

## Decisions (validated 2026-08-31)

| Question | Decision |
|---|---|
| Direction | **C — both ends**: the book opens at the click (Moment A) *and* the reading page opens on arrival (Moment B) |
| Moment A treatment | **A3 · Page Cascade** — cover swings open, then three pages turn in a cascade before settling |
| Moment B treatment | **B1 · Spread Open** — the closed book opens and dissolves into the cream reading page |
| Pacing | **Cinematic** — all timings at ~1.5× the original pass (~2.9s / ~2.7s totals) |
| A → B hand-off | **Light veil** — a soft golden bloom masks the page navigation |

Rejected alternatives (kept in the preview artifact for reference): A1 Cover Swing (fastest, recommended by me but user preferred the fuller ritual), A2 Seam of Light, B2 Page Rise.

## Proposed flow

```
closed book (static)                      ← anonymous, Bible mode
  → click "Flip open the Bible"
  → Moment A: page cascade plays (~1.8s hold)
  → golden veil fades in; form submits
  → server draws verses (~0.2–0.6s, hidden)
  → next page loads; veil fades out
  → Moment B: reading page spreads open (~2.7s)
  → reading (verses highlighted, position tags)
```

The animation replaces the "please wait…" label as the wait indicator — it *is* the wait.

## Moment A — Page Cascade at the click

**Where:** `index.astro`, the anonymous Bible flip panel (`.bible-flip-panel`, `#bible-flip-btn`, currently lines ~649–660) and its handler (~line 1234). The static `.bible-flip-book` span is replaced by a 3D scene (same visual size, 150×200 desktop / 120×164 mobile — keep both media-query sizes).

**Markup sketch:**

```html
<button type="submit" class="bible-flip-btn" id="bible-flip-btn">
  <span class="bible-scene" aria-hidden="true">
    <span class="bible-book">
      <span class="bible-book-glow"></span>
      <span class="bible-pageblock">
        <span class="bible-page-face"><!-- cream face + faint text lines --></span>
        <span class="bible-leaf l1"><span class="bible-leaf-rot">…</span></span>
        <span class="bible-leaf l2"><span class="bible-leaf-rot">…</span></span>
        <span class="bible-leaf l3"><span class="bible-leaf-rot">…</span></span>
      </span>
      <span class="bible-cover">
        <span class="bible-cover-front">✝</span>
        <span class="bible-cover-back"></span>
      </span>
    </span>
  </span>
  <span class="bible-flip-label">Flip open the Bible / 翻开圣经</span>
</button>
```

3D structure: `.bible-scene` gets `perspective: 1000px`; `.bible-book` is `transform-style: preserve-3d`; the cover is a two-face flip box (front = today's purple/gold gradient, back = dark inside cover, both `backface-visibility: hidden`), `transform-origin: left center`. Leaves stack on the page block at `translateZ(3/2/1px)` and rotate `rotateY(-180deg)` around the spine; the open cover lies beneath them.

**Timings (cinematic, as validated):**

| Element | Animation | Duration | Delay | Result |
|---|---|---|---|---|
| book lift | translateY 0 → −9px → −5px | 2.85s ease | 0.15s | subtle rise through the ritual |
| cover | rotateY 0 → −166° | 0.75s cubic-bezier(.5,.05,.35,1) | 0.15s | cover opens fast |
| glow | radial gold bloom, opacity 0 → .85 → .5 | 2.1s ease | 0.68s | light spills from the seam |
| leaf 1/2/3 | rotateY 0 → −180° | 0.75s each, cubic-bezier(.45,.08,.4,1) | 0.83 / 1.43 / 2.03s | cascade of turning pages |
| page face | opacity .45 → 1 | 0.9s ease | 2.25s | the spread settles |

**JS behavior (replaces the current instant submit):**

```js
flipBtn.addEventListener('click', (e) => {
  if (prefersReducedMotion) return;          // native submit, no animation
  if (panel.classList.contains('is-opening')) { e.preventDefault(); return; }
  e.preventDefault();
  panel.classList.add('is-opening');          // runs the keyframes
  setTimeout(() => {                          // second page has landed
    veil.classList.add('on');                 // golden veil over viewport
    form.submit();                            // real POST, unchanged endpoint
  }, 1800);
});
```

- The button stays a real submit button (Enter key still works); the handler only *defers* the submit by ~1.8s.
- Server round-trip variance: the server answers in ~0.2–0.6s; navigation happens at ~1.8s+, so the cascade is never visibly cut mid-leaf. If the server is ever slower than ~2.4s, the veil is already up — it *is* the loading state.
- Double-submit guard: `is-opening` class; button visually disabled while opening.
- i18n: zh/en labels unchanged. The old "please wait…" label swap becomes an `aria-live="polite"` status ("Opening the Bible… / 正在翻开圣经…") announced at click.

## Hand-off veil

One fixed-position overlay (`<div class="bible-veil">`), rendered in `index.astro` only when the flip panel renders:

- `background: radial-gradient(circle at 50% 45%, rgba(246,218,138,.28), rgba(10,8,16,.92) 58%)`, `opacity 0 → 1` in 0.4s at submit, fades out ~0.3s after the next page paints (its `DOMContentLoaded`), then `display: none`.
- Purely presentational; `pointer-events: none` so it never traps clicks; removed entirely under `prefers-reduced-motion`.

## Moment B — Spread Open on arrival

**Where:** the server-rendered pending Bible page view (`.bible-page` with chapter context) — the only surface that renders the real-bible-page style. The registered reveal result renders verse cards (`.verse-card`), not `.bible-page`, so it intentionally gets no arrival animation. Wrap the existing `.bible-page` markup; do not restyle the page itself.

**Markup sketch:**

```html
<div class="bible-arrive" id="bible-arrive">
  <div class="bible-arrive-clip">
    <div class="bible-arrive-book" aria-hidden="true"><!-- small closed book, same cover style --></div>
    <div class="bible-page"> …existing markup, untouched… </div>
  </div>
</div>
<script>document.getElementById('bible-arrive').classList.add('arrive');</script>
```

- The inline script sits immediately after the wrapper so the "closed" state is applied before first paint (no FOUC). No JS (or script failure) ⇒ page renders fully visible, static. Progressive enhancement by construction.
- Back/forward cache: on `pageshow` with `event.persisted`, remove the class so restored pages appear instantly.

**Timings (cinematic, as validated):**

| Element | Animation | Duration | Delay | Result |
|---|---|---|---|---|
| cover | rotateY 0 → −165° | 1.2s cubic-bezier(.55,.08,.35,1) | 0.18s | the small book opens |
| book | opacity → 0, translateY −14px | 0.68s ease | 0.93s | book dissolves |
| page | clip-path `inset(0 46% 0 46% round 10px)` → `inset(0 0 0 0 round 10px)` + opacity | 1.2s cubic-bezier(.3,.6,.2,1) | 0.75s | spread widens from the spine |
| chapter heading | opacity + translateY −8px | 0.68s ease | 1.28s | title settles |
| verse spans (5) | opacity | 0.6s each | 1.38 / 1.5 / 1.62 / 1.74 / 1.86s | text fades up line by line |
| drawn verse | background-size 0 → 100% (gold highlight) + inset ring | 0.83s ease-out | 1.88s | highlight sweeps onto verse 1 |

Stagger targets `.bible-flow .v` via `nth-of-type` delays — works with the existing single justified paragraph; the drawn-verse sweep reuses the existing `.bible-verse-drawn` gradient as its end state, so final frame = today's look exactly.

## Reduced motion & fallbacks

- `@media (prefers-reduced-motion: reduce)`: all arrival/opening animations collapse to a 200ms opacity cross-fade; Moment A submits immediately; veil disabled. (One block in `global.css`.)
- Old Android WebView without smooth 3D: degrades to the same reduced-motion path; nothing is gated behind the animation.
- All glows animate `opacity` only — never `filter: blur()` (mobile GPU cost). Clip-path and transform/opacity only elsewhere.
- Error views (`reveal-gate` cards: trial credits used, daily limit, generation failure, Pro gate) never render `.bible-page`, so they get no arrival animation — unchanged.

## Testing

- **Unit (vitest):** none required for CSS; if the hold-submit logic moves into a helper, test the reduced-motion + double-click guards with fake timers.
- **E2E (Playwright, `.e2e/`):** anonymous Bible flip → cascade classes appear → form still POSTs → pending `.bible-page` renders with `.arrive`; quota-gate path renders the gate card without `.bible-page`; both zh and en.
- **Manual matrix:** Safari iOS (3D transforms + clip-path), Chrome Android mid-range (glow perf), Firefox (clip-path `round` keyword), back-button bfcache restore, reduced-motion OS setting, 2G throttled server response (veil behaves as loading state).

## Rollout

Single commit; pure front-end; instant revert by reverting the commit. No feature flag needed — the flip button is anonymous-only today, so blast radius is the anonymous Bible flow plus the two Bible result views.

## Open questions

1. **Registered users:** should Moment A also decorate the registered Bible flow (Explore submit)? Recommended yes for coherence, but the registered flow has spread-picker UI, not the flip button — needs its own small decision. Moment B already applies to registered result views.
2. **Replay guard:** the arrival animation plays on every load (including refresh). If it ever feels repetitive, add a `sessionStorage` guard — deliberately left out of v1 so the effect stays observable.
3. Extra notes from the review (Q5): none received.

## References

- Interactive preview with the validated demos: `docs/previews/bible-opening-preview.html` (self-contained, opens in any browser).
- Current code: `src/pages/index.astro` (flip panel ~649–660, handler ~1234, pending view ~743), `src/styles/global.css` (`.bible-flip-*` ~577–622, `.bible-page` ~623–656).
