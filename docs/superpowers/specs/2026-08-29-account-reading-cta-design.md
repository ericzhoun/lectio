# Account Page Reading CTA — Design

**Date:** 2026-08-29
**Status:** Approved
**Goal:** Adjust `/account` so it actively encourages signed-in users to start a tarot reading right away.

## Problem

The account page (`src/pages/account.astro`) currently shows profile metadata, plan/usage stats, and administrative actions (manage subscription, view history, log out). There is no call-to-action leading users back into the core feature — the tarot reading at `/`. Newly registered users (who arrive via `?welcome=1`) see a credits banner but no obvious next step.

## Design

Approach chosen: **Hero CTA section** — a visually prominent panel at the top of the page showing remaining quota/credits and a one-click jump to the reading page, plus supporting nudges.

### 1. Hero CTA panel (new section, above `.profile-card`)

A new `<section class="reading-cta">` rendered for every signed-in user:

- **Headline**
  - en: `Ready for today's reading?`
  - zh: `准备好今天的解读了吗？`
- **Status line** (derived from data already loaded in `account.astro` — `tier`, `usedToday`, `quota`, `creditBalance`; no new DB queries):
  - Quota available (`usedToday < quota`):
    - Finite quota: `X of Y draws left today` / zh: `今日剩余 X / Y 次`
    - `quota === Infinity` (pro): `Unlimited draws today` / zh: `今日解读次数不限`
  - Free tier with remaining trial credits (`creditBalance['3card'] > 0 || creditBalance.celtic_cross > 0`), appended as a second line: `Plus trial credits: 3-card ×N · Celtic Cross ×N` / zh: `另有体验额度：三张牌阵 ×N · 凯尔特十字 ×N`
- **Primary button**: `Start your reading` / zh: `开始解读` — plain link styled as a prominent gold button, `href="/?lang={lang}"`.
- **Exhausted state** (finite quota and `usedToday >= quota`): replace the status line with `You've used today's draws — subscribe to keep going` / zh: `今日次数已用完 — 订阅后可继续解读`, and replace the primary button with a link to `/pricing?lang={lang}` labeled `See subscription plans` / zh: `查看订阅方案`. (Free tier users can also still have unused trial credits; when credits remain, the panel stays in the "available" state because a reading is still possible.)

Exhaustion rule (exact): `const exhausted = quota !== Infinity && usedToday >= quota && !(tier === 'free' && creditBalance && (creditBalance['3card'] > 0 || creditBalance.celtic_cross > 0));`

### 2. Welcome banner upgrade

The existing `?welcome=1` banner (`.auth-welcome`) keeps its current message but gains a centered button below the text: `Start your first reading` / zh: `开始第一次解读`, linking to `/?lang={lang}`. This gives brand-new accounts an immediate one-click path from signup to reading.

### 3. Actions row

Add a primary `Start reading` / zh: `开始解读` button (`explore-button` style, linking `/?lang={lang}`) as the **first** item in `.profile-actions`, before Manage subscription / View history / Log out.

### 4. Styling

New rules in `src/styles/global.css`, following the existing dark-theme conventions (CSS variables `--panel`, `--panel-border`, `--gold`, `--accent`; rounded corners; soft shadows):

- `.reading-cta`: full-width panel above `.profile-card`, gold-tinted border/background echoing `.auth-welcome` (`rgba(232,196,101,0.1)` background, `rgba(232,196,101,0.4)` border), `border-radius: 14px`, centered text, `margin-bottom: 24px`.
- `.reading-cta-title`: heading styling consistent with page typography.
- `.reading-cta-status`: dim secondary text (`--text-dim`).
- `.reading-cta-button`: primary gold CTA button (gold background, dark text, pill radius like `.explore-button`, hover slightly brighter). Reused for both the hero button and the welcome-banner button.

No layout changes to `.profile-card` itself.

## Files changed

| File | Change |
|---|---|
| `src/pages/account.astro` | Add hero CTA section, welcome-banner button, actions-row button; compute `remaining`/`exhausted` from existing locals |
| `src/styles/global.css` | Add `.reading-cta*` styles |

## Constraints

- Presentational only — no changes to entitlements, DB, or API routes.
- Bilingual zh/en using the existing inline-ternary pattern; all links carry `?lang={lang}`.
- Server-rendered (page stays `prerender = false`).

## Test plan

Manual verification via `npm run dev`:

1. `/account` in en and zh: hero panel shows correct remaining-draws line for free tier.
2. Free tier with trial credits: credits line appears.
3. Pro subscriber: "Unlimited draws today" line.
4. Exhausted free quota with no credits left: pricing link replaces primary CTA.
5. `/account?welcome=1`: banner shows button that navigates to `/?lang=…`.
6. Actions row: Start reading appears first and navigates home with lang preserved.
7. Both links/buttons respect the language switcher (cookie + `?lang`).
