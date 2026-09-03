# Account Page Reading CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prominent "start your reading" CTA panel (plus welcome-banner and actions-row nudges) to `/account` so signed-in users are encouraged to use the tarot reading feature right away.

**Architecture:** A small pure helper (`src/lib/cta.ts`) computes the CTA state (exhausted / remaining draws / trial credits) from values `account.astro` already loads; the page renders a hero panel, an upgraded welcome banner, and an extra actions-row button. Purely presentational — no entitlement/DB/API changes.

**Tech Stack:** Astro SSR (Cloudflare Workers adapter), TypeScript, Vitest, plain CSS (dark theme, CSS variables).

**Spec:** `docs/superpowers/specs/2026-08-29-account-reading-cta-design.md`

---

### Task 1: Pure CTA-state helper (TDD)

**Files:**
- Create: `src/lib/cta.ts`
- Test: `src/lib/__tests__/cta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/cta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getReadingCtaState } from '../cta';

describe('getReadingCtaState', () => {
  it('free tier mid-day with credits: not exhausted, remaining draws, credits flagged', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 2,
        quota: 6,
        creditBalance: { '3card': 3, celtic_cross: 1 },
      })
    ).toEqual({ exhausted: false, remaining: 4, hasTrialCredits: true });
  });

  it('free tier quota exhausted with no credits: exhausted', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 6,
        quota: 6,
        creditBalance: { '3card': 0, celtic_cross: 0 },
      })
    ).toEqual({ exhausted: true, remaining: 0, hasTrialCredits: false });
  });

  it('free tier quota exhausted but trial credits remain: not exhausted', () => {
    expect(
      getReadingCtaState({
        tier: 'free',
        usedToday: 6,
        quota: 6,
        creditBalance: { '3card': 1, celtic_cross: 0 },
      })
    ).toEqual({ exhausted: false, remaining: 0, hasTrialCredits: true });
  });

  it('basic tier quota exhausted: exhausted', () => {
    expect(
      getReadingCtaState({ tier: 'basic', usedToday: 20, quota: 20, creditBalance: null })
    ).toEqual({ exhausted: true, remaining: 0, hasTrialCredits: false });
  });

  it('pro tier unlimited quota: never exhausted, remaining is null', () => {
    expect(
      getReadingCtaState({ tier: 'pro', usedToday: 42, quota: Infinity, creditBalance: null })
    ).toEqual({ exhausted: false, remaining: null, hasTrialCredits: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/cta.test.ts`
Expected: FAIL — cannot resolve `../cta`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cta.ts`:

```ts
import type { Tier } from './entitlements';
import type { CreditBalance } from './credits';

export interface ReadingCtaState {
  /** True when no reading is possible today (quota exhausted and no trial credits left). */
  exhausted: boolean;
  /** Draws remaining today; null when the tier's quota is unlimited. */
  remaining: number | null;
  /** True when a free-tier account has unused multi-card trial credits. */
  hasTrialCredits: boolean;
}

/** Derive the account-page reading CTA state from values already loaded by the page. */
export function getReadingCtaState(args: {
  tier: Tier;
  usedToday: number;
  quota: number;
  creditBalance: CreditBalance | null;
}): ReadingCtaState {
  const { tier, usedToday, quota, creditBalance } = args;
  const hasTrialCredits =
    tier === 'free' &&
    !!creditBalance &&
    (creditBalance['3card'] > 0 || creditBalance.celtic_cross > 0);
  const unlimited = quota === Infinity;
  const remaining = unlimited ? null : Math.max(quota - usedToday, 0);
  const exhausted = !unlimited && usedToday >= quota && !hasTrialCredits;
  return { exhausted, remaining, hasTrialCredits };
}
```

Note: both imports are `import type`, so the module has no runtime dependencies and runs cleanly under Vitest.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/cta.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cta.ts src/lib/__tests__/cta.test.ts
git commit -m "feat(account): add pure helper for reading CTA state"
```

---

### Task 2: Account page — hero CTA panel, welcome button, actions button

**Files:**
- Modify: `src/pages/account.astro`

- [ ] **Step 1: Import helper and compute state**

In the frontmatter of `src/pages/account.astro`, add the import after the `getUserById` import:

```ts
import { getReadingCtaState } from '../lib/cta';
```

After the `welcome` const, add:

```ts
const cta = getReadingCtaState({ tier, usedToday, quota, creditBalance });
```

- [ ] **Step 2: Upgrade the welcome banner with a button**

Replace the existing welcome block:

```astro
{welcome && (
  <p class="auth-welcome" role="status">
    {lang === 'zh'
      ? '🎉 注册成功！每日单张解读已升至 6 次，三张牌阵 ×3、凯尔特十字 ×1 体验额度已到账'
      : '🎉 Account created! Daily single draws are now 6/day, and your trial credits (3-card ×3, Celtic Cross ×1) are ready.'}
  </p>
)}
```

with:

```astro
{welcome && (
  <div class="auth-welcome">
    <p role="status">
      {lang === 'zh'
        ? '🎉 注册成功！每日单张解读已升至 6 次，三张牌阵 ×3、凯尔特十字 ×1 体验额度已到账'
        : '🎉 Account created! Daily single draws are now 6/day, and your trial credits (3-card ×3, Celtic Cross ×1) are ready.'}
    </p>
    <a class="reading-cta-button" href={`/?lang=${lang}`}>
      {lang === 'zh' ? '开始第一次解读' : 'Start your first reading'}
    </a>
  </div>
)}
```

- [ ] **Step 3: Add the hero CTA panel**

Insert directly after the welcome block and before `<div class="profile-card">`:

```astro
<section class="reading-cta">
  <h2 class="reading-cta-title">
    {lang === 'zh' ? '准备好今天的解读了吗？' : "Ready for today's reading?"}
  </h2>
  {cta.exhausted ? (
    <>
      <p class="reading-cta-status">
        {lang === 'zh'
          ? '今日次数已用完 — 订阅后可继续解读'
          : "You've used today's draws — subscribe to keep going"}
      </p>
      <a class="reading-cta-button" href={`/pricing?lang=${lang}`}>
        {lang === 'zh' ? '查看订阅方案' : 'See subscription plans'}
      </a>
    </>
  ) : (
    <>
      <p class="reading-cta-status">
        {cta.remaining === null
          ? (lang === 'zh' ? '今日解读次数不限' : 'Unlimited draws today')
          : (lang === 'zh'
              ? `今日剩余 ${cta.remaining} / ${quota} 次`
              : `${cta.remaining} of ${quota} draws left today`)}
      </p>
      {cta.hasTrialCredits && creditBalance && (
        <p class="reading-cta-status">
          {lang === 'zh'
            ? `另有体验额度：三张牌阵 ×${creditBalance['3card']} · 凯尔特十字 ×${creditBalance.celtic_cross}`
            : `Plus trial credits: 3-card ×${creditBalance['3card']} · Celtic Cross ×${creditBalance.celtic_cross}`}
        </p>
      )}
      <a class="reading-cta-button" href={`/?lang=${lang}`}>
        {lang === 'zh' ? '开始解读' : 'Start your reading'}
      </a>
    </>
  )}
</section>
```

- [ ] **Step 4: Add Start reading to the actions row**

In `<div class="profile-actions">`, insert as the first child:

```astro
<a class="explore-button" href={`/?lang=${lang}`}>{lang === 'zh' ? '开始解读' : 'Start reading'}</a>
```

- [ ] **Step 5: Type check**

Run: `npx astro check`
Expected: no errors in `src/pages/account.astro`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account.astro
git commit -m "feat(account): add reading CTA panel and start-reading actions"
```

---

### Task 3: Styles

**Files:**
- Modify: `src/styles/global.css` (after the `/* ---------- Account profile ---------- */` block, ~line 319)

- [ ] **Step 1: Add the CTA styles**

Append after the `.profile-actions .reset-button:hover` rule (before the `/* ---------- Privacy policy page ---------- */` comment):

```css
/* ---------- Account reading CTA ---------- */
.reading-cta {
  background: rgba(232,196,101,0.1); border: 1px solid rgba(232,196,101,0.4);
  border-radius: 14px; padding: 28px 32px; margin: 8px 0 24px;
  text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
}
.reading-cta-title { margin: 0 0 10px; font-size: 22px; color: var(--gold); }
.reading-cta-status { margin: 0 0 10px; color: var(--text-dim); font-size: 15px; }
.reading-cta-button {
  display: inline-block; background: var(--gold); color: #1c1503;
  padding: 10px 26px; margin-top: 8px; border-radius: 20px;
  font-size: 16px; font-weight: 600; text-decoration: none;
  transition: filter 0.3s;
}
.reading-cta-button:hover { filter: brightness(1.1); }
.auth-welcome p { margin: 0; }
.auth-welcome .reading-cta-button { margin-top: 12px; }
```

(The `.auth-welcome p` reset keeps the welcome banner tidy now that it wraps a `<p>` instead of being one.)

- [ ] **Step 2: Commit**

```bash
git add src/styles/global.css
git commit -m "style(account): add reading CTA panel and gold button styles"
```

---

### Task 4: Full verification

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: all tests pass (including the 5 new `cta` tests).

- [ ] **Step 2: Type check + build**

Run: `npx astro check && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 3: Smoke test (dev server)**

Run: `npm run dev`, then verify in a browser:

1. `/account` (en): hero panel shows `Ready for today's reading?`, `X of 6 draws left today`, trial-credits line, gold `Start your reading` button linking to `/?lang=en`.
2. Switch to zh (via layout switcher or `?lang=zh`): all CTA copy renders in Chinese; language persists through the `/?lang=…` link.
3. `/account?welcome=1`: banner now includes `Start your first reading` button.
4. Actions row: `Start reading` is the first action.
5. Exhausted state (optional, simulate by drawing 6 times or editing usage): panel shows pricing link instead of start button.
