# Lectio Mobile Web Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six-step `/today` practice effortless on a phone: thumb-first nav shell, chrome-free ritual-mode steps with a bottom-anchored action, PWA-lite install primitives, safe-area/`dvh` correctness, 44px targets, a tamed assistant widget, and an inline shimmer instead of the viewport-blocking loader.

**Architecture:** Presentation-only changes. A new `MobileNav.astro` component becomes the ≤760px shell; `Layout.astro` gains a `chrome="minimal"` prop so `/today` pages opt out of site chrome and render their own full-height ritual frame; static PWA assets land in `public/`; the AI-wait overlay becomes an inline shimmer panel. No lib/, DB, entitlement, or route changes.

**Tech Stack:** Astro 7 (SSR, Cloudflare adapter), vanilla CSS in `src/styles/global.css` + scoped component styles, no new runtime dependencies (one dev-only `sharp` use for icon generation).

**Spec:** `docs/superpowers/specs/2026-09-06-mobile-usability-design.md` — the plan implements it section by section (§4.1→Task 2, §4.2→Task 3, §4.3→Task 1, §4.4→Task 4, §4.5→Task 6, §4.6→Task 5, §4.7→Task 7).

## Global Constraints

- Design tokens live in `src/styles/global.css` (`--bg #0e1220`, `--panel #171c2e`, `--panel-border #2a3050`, `--gold #e8c465`, `--text #e8e9f0`, `--text-dim #9aa0b8`, `--accent #6c7dfa`, `--pill-bg #232a45`). Never hard-code surface colors where a token exists; light-theme overrides follow the `[data-theme="light"] …` pattern already in that file.
- Mobile breakpoint is **760px** (`@media (max-width: 760px)`).
- Tap targets ≥ **44×44px** (sheet rows ≥ 48px); every `<input>`/`<textarea>` font-size ≥ **16px**.
- Every new user-facing string ships in **both** languages, using the existing `lang === 'zh' ? '…' : '…'` convention.
- Z-order contract (top wins): loader 1000 → gate modal 100 → assistant 60 → mobile shell 50.
- `prefers-reduced-motion: reduce` must disable every new animation.
- **Untouchable:** `src/lib/entitlements.ts`, `src/lib/credits.ts`, `src/lib/ab.ts`, `SPREADS` keys, `PENDING_DRAW_COOKIE` flow, `LoginForm.astro` markup/order/copy (running `signup_cta_copy` A/B — size-only CSS changes allowed via `global.css`).
- No service worker, no new routes, no new backend endpoints.
- Testing reality: all tasks are presentation changes — the test cycle per task is `npx astro check` (types), `npm test` (existing 294-test suite must stay green), `npm run build`, and the named manual verification. There are no new unit-testable pure functions; do not invent tests for markup.
- Commit after every task; never push unless asked.

---

### Task 1: PWA-lite — manifest, icons, theme-color (Spec §4.3, M-03)

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/logo-192.png` (generated, committed)
- Create: `scripts/make-icons.mjs` (one-off generator)
- Modify: `src/layouts/Layout.astro` (head: viewport-fit, manifest link, apple-touch-icon, theme-color meta + sync in the pre-paint script)
- Modify: `public/_headers` (cache rule for the two new assets)
- Modify: `docs/superpowers/specs/2026-09-06-mobile-usability-design.md` (§4.3 amendment: single script-synced `theme-color` meta instead of a media-based pair — a script cannot override media-scoped metas, and the resolved theme must win over the OS preference)

**Interfaces:**
- Produces: `<meta name="theme-color" id="theme-color-meta" content="#0e1220">` present in every page head (Task 2's CSS and the pre-paint script rely on it); `public/logo-192.png` referenced by both manifest and `apple-touch-icon`.

- [ ] **Step 1: Verify the current absence**

Run: `grep -rn "theme-color\|manifest" src/layouts/Layout.astro public/_headers`
Expected: no matches.

- [ ] **Step 2: Write the icon generator and run it once**

Create `scripts/make-icons.mjs`:

```js
// One-off: generate public/logo-192.png from public/logo.webp for the PWA
// manifest and apple-touch-icon. Run: npm i -D sharp && node scripts/make-icons.mjs
// sharp is NOT a runtime dependency; delete it from devDependencies afterwards
// if you do not want to keep it (the PNG is committed).
import sharp from 'sharp';

await sharp('public/logo.webp').resize(192, 192).png().toFile('public/logo-192.png');
console.log('wrote public/logo-192.png');
```

Run: `npm i -D sharp && node scripts/make-icons.mjs`
Expected: "wrote public/logo-192.png"; the file is a 192×192 PNG.

- [ ] **Step 3: Write the manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "Lectio",
  "short_name": "Lectio",
  "description": "Daily Lectio Divina scripture reflection in English and Chinese.",
  "start_url": "/today",
  "display": "standalone",
  "background_color": "#0e1220",
  "theme_color": "#0e1220",
  "icons": [
    { "src": "/logo-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/logo.webp", "sizes": "512x512", "type": "image/webp", "purpose": "any" }
  ]
}
```

- [ ] **Step 4: Wire the head in `src/layouts/Layout.astro`**

Change the viewport meta (line 39):

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

Add after the favicon links (lines 84-85):

```html
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/logo-192.png" />
  <meta name="theme-color" id="theme-color-meta" content="#0e1220" />
```

Inside the existing pre-paint theme script (lines 42-54), after
`document.documentElement.setAttribute('data-theme', t);` add theme-color sync so the
resolved theme wins over the OS preference:

```js
        var m = document.getElementById('theme-color-meta');
        if (m) m.setAttribute('content', t === 'light' ? '#f5f2ea' : '#0e1220');
```

The script's catch branch already forces `data-theme="dark"`; add the same two lines
there so a localStorage failure still colors the status bar. (Duplicate the lines inside
the `catch { … }` block, after its `setAttribute` call.)

- [ ] **Step 5: Cache rule in `public/_headers`**

Append:

```
# PWA identity files. The manifest references content-addressed icons, so a
# one-day client cache is safe and cheap.
/manifest.webmanifest
  Cache-Control: public, max-age=86400
/logo-192.png
  Cache-Control: public, max-age=86400
```

- [ ] **Step 6: Amend the spec**

In `docs/superpowers/specs/2026-09-06-mobile-usability-design.md`, replace the sentence
beginning "and two `<meta name="theme-color">` tags" with:

> one `<meta name="theme-color" id="theme-color-meta">` (dark default), which the
> existing pre-paint theme script sets to the *resolved* theme — a script cannot
> override media-scoped metas, and the resolved theme must win over the OS preference.

- [ ] **Step 7: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: `astro check` reports no new errors (the pre-existing `scripts/tts/lib.mts:174`
and `[step].astro` ts(6133) hints may appear), all tests pass, build succeeds.

Manual: `npx wrangler dev`, then confirm `/manifest.webmanifest` returns JSON,
`/logo-192.png` returns the PNG, and the home page head contains the three new tags.
In devtools, Application → Manifest shows "Installable" with the Lectio icon.

- [ ] **Step 8: Commit**

```bash
git add public/manifest.webmanifest public/logo-192.png public/_headers scripts/make-icons.mjs src/layouts/Layout.astro docs/superpowers/specs/2026-09-06-mobile-usability-design.md package.json package-lock.json
git commit -m "feat(mobile): PWA-lite — manifest, icons, script-synced theme-color (M-03)"
```

---

### Task 2: MobileNav — thumb bar + full-screen sheet (Spec §4.1, M-01)

**Files:**
- Create: `src/components/MobileNav.astro`
- Modify: `src/layouts/Layout.astro` (render the component; import it)
- Modify: `src/styles/global.css` (mobile shell styles + `.top-nav` progressive-enhancement swap)

**Interfaces:**
- Consumes: `langSwitchHref(astro: LangRequestContext, target: Lang)` from `src/lib/i18n.ts` (same call shape as `Layout.astro:111-112`); `Lang` type from `src/lib/reading.ts`; `userId` already computed in `Layout.astro`.
- Produces: `document.documentElement.classList.add('js-nav')` when the sheet script runs (Task 3 and the CSS below rely on the `html.js-nav` hook); component root `.mobile-nav` visible only ≤760px.

- [ ] **Step 1: Create `src/components/MobileNav.astro`**

```astro
---
// Mobile shell (≤760px): sticky thumb bar + full-screen navigation sheet.
// Desktop keeps .top-nav until the site-wide redesign adopts this component.
import { langSwitchHref } from '../lib/i18n';
import type { Lang } from '../lib/reading';

interface Props {
  lang: Lang;
  loggedIn: boolean;
}
const { lang, loggedIn } = Astro.props;

const t = {
  menu: lang === 'zh' ? '菜单' : 'Menu',
  close: lang === 'zh' ? '关闭' : 'Close',
  today: lang === 'zh' ? '今日' : 'Today',
  library: lang === 'zh' ? '经文库' : 'Verse Library',
  approach: lang === 'zh' ? '方法' : 'Approach',
  pricing: lang === 'zh' ? '价格' : 'Pricing',
  privacy: lang === 'zh' ? '隐私' : 'Privacy',
  account: lang === 'zh' ? '账户' : 'Account',
  login: lang === 'zh' ? '登录' : 'Log in',
  hint: {
    library: lang === 'zh' ? '148 段经文' : '148 passages',
    approach: lang === 'zh' ? '什么是圣言诵读' : 'what is Lectio?',
    pricing: lang === 'zh' ? '首月免费' : 'first month free',
    privacy: lang === 'zh' ? '你的回应不被追踪' : 'your words stay yours',
  },
};
const loginHref = `/login?lang=${lang}&returnTo=${encodeURIComponent(Astro.url.pathname + Astro.url.search)}`;
---
<div class="mobile-nav">
  <nav class="mn-bar" aria-label={t.menu}>
    <a class="mn-brand" href="/">✦ Lectio</a>
    <div class="mn-actions">
      <a class="mn-today" href="/today" data-event="cta_click" data-event-props='{"slot":"nav_today"}'>{t.today}</a>
      <button type="button" class="mn-toggle" id="mn-toggle"
        aria-expanded="false" aria-controls="mn-sheet" aria-label={t.menu}>
        <span class="mn-burger" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
    </div>
  </nav>
  <div class="mn-sheet" id="mn-sheet" hidden>
    <div class="mn-sheet-head">
      <span>{t.menu}</span>
      <button type="button" class="mn-close" id="mn-close" aria-label={t.close}>✕</button>
    </div>
    <a class="mn-row" href="/library"><span>{t.library}</span><span class="mn-hint">{t.hint.library}</span></a>
    <a class="mn-row" href="/approach"><span>{t.approach}</span><span class="mn-hint">{t.hint.approach}</span></a>
    <a class="mn-row" href="/pricing" data-event="cta_click" data-event-props='{"slot":"nav_pricing"}'><span>{t.pricing}</span><span class="mn-hint">{t.hint.pricing}</span></a>
    <a class="mn-row" href="/privacy"><span>{t.privacy}</span><span class="mn-hint">{t.hint.privacy}</span></a>
    <a class="mn-row" href={langSwitchHref(Astro, 'zh')}>中文</a>
    <a class="mn-row" href={langSwitchHref(Astro, 'en')}>English</a>
    <a class="mn-row" href={loggedIn ? '/account' : loginHref}>{loggedIn ? t.account : t.login}</a>
  </div>
</div>

<script>
  // Progressive enhancement: hiding the 9-link .top-nav on phones is keyed on
  // this class, so without JS the familiar link list still works.
  document.documentElement.classList.add('js-nav');

  const toggle = document.getElementById('mn-toggle') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('mn-close') as HTMLButtonElement | null;
  const sheet = document.getElementById('mn-sheet') as HTMLElement | null;

  const setOpen = (open: boolean) => {
    if (!sheet || !toggle) return;
    sheet.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };

  toggle?.addEventListener('click', () => setOpen(sheet?.hidden ?? false));
  closeBtn?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
</script>
```

- [ ] **Step 2: Render it in `src/layouts/Layout.astro`**

Add to the imports (after `import AssistantWidget …`):

```astro
import MobileNav from '../components/MobileNav.astro';
```

Inside `<body>`, immediately after the closing `</div>` of `.top-nav` (after line 113), add:

```astro
  <MobileNav lang={lang} loggedIn={!!userId} />
```

- [ ] **Step 3: Shell styles in `src/styles/global.css`**

Append at the end of the file:

```css
/* ---------- Mobile shell: thumb bar + sheet (M-01) ---------- */
.mobile-nav { display: none; }
@media (max-width: 760px) {
  .mobile-nav { display: block; position: sticky; top: 0; z-index: 50; }
  /* Progressive enhancement: only hide the desktop links once the sheet's
     script is running, so no-JS visitors keep the working .top-nav. */
  html.js-nav .top-nav { display: none; }
}
.mn-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 48px; padding: 0 12px;
  padding-top: max(0px, env(safe-area-inset-top));
  background: rgba(23, 28, 46, 0.92);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--panel-border);
}
[data-theme="light"] .mn-bar { background: rgba(255, 255, 255, 0.92); }
.mn-brand { color: var(--gold); font-weight: bold; letter-spacing: 1px; text-decoration: none; font-size: 15px; }
.mn-actions { display: flex; align-items: center; gap: 8px; }
.mn-today {
  display: inline-flex; align-items: center; min-height: 44px;
  background: var(--gold); color: #1c1503; font-weight: 600; font-size: 14px;
  padding: 0 16px; border-radius: 999px; text-decoration: none;
}
.mn-toggle, .mn-close {
  background: none; border: none; cursor: pointer; color: var(--text-dim);
  min-width: 44px; min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 16px;
}
.mn-toggle:hover, .mn-close:hover { color: var(--text); }
.mn-burger { display: inline-flex; flex-direction: column; gap: 3px; }
.mn-burger i { width: 16px; height: 2px; background: var(--text-dim); border-radius: 2px; }
.mn-sheet {
  position: fixed; inset: 0; z-index: 55;
  background: var(--bg); overflow-y: auto;
  padding: max(12px, env(safe-area-inset-top)) 0 max(12px, env(safe-area-inset-bottom));
}
.mn-sheet-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 18px 10px; color: var(--gold);
  letter-spacing: 2px; text-transform: uppercase; font-size: 11px;
}
.mn-row {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  min-height: 48px; padding: 0 18px;
  border-bottom: 1px solid var(--panel-border);
  color: var(--text); text-decoration: none; font-size: 15px;
}
.mn-row:hover { background: var(--pill-bg); }
.mn-hint { color: var(--text-dim); font-size: 12px; }
```

- [ ] **Step 4: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; all tests pass; build succeeds.

Manual (`npx wrangler dev`, devtools mobile viewport 375px): the bar shows brand + gold
Today pill + ☰; the 9-link list is gone; ☰ opens a full-screen sheet whose rows navigate
correctly (check 中文/English switches language and returns you to the same page; logged-out
shows 登录/Log in, logged-in shows 账户/Account); Escape closes the sheet; at 900px width
the desktop `.top-nav` renders exactly as before. Re-check with JS disabled: the `.top-nav`
links are back and the page is fully navigable.

- [ ] **Step 5: Commit**

```bash
git add src/components/MobileNav.astro src/layouts/Layout.astro src/styles/global.css
git commit -m "feat(mobile): thumb nav bar + full-screen sheet at ≤760px (M-01)"
```

---

### Task 3: Ritual mode — chrome-free steps with a bottom-anchored action (Spec §4.2, M-02)

**Files:**
- Modify: `src/layouts/Layout.astro` (`chrome="minimal"` prop)
- Modify: `src/components/DailyProgress.astro` (`variant="dots"`)
- Modify: `src/pages/today/[step].astro` (ritual frame; action bar)
- Modify: `src/pages/today/amen.astro` (same frame)
- Modify: `src/styles/global.css` (ritual frame styles shared by both pages)

**Interfaces:**
- Consumes: `STEP_ORDER`, `stepIndex`, `STEP_COPY` from `src/lib/dailySteps.ts` (existing exports); `DailyProgress` props `reached: Step, current: Step, lang: Lang` (existing).
- Produces: `Layout` prop `chrome?: 'minimal'` (other pages unaffected); `DailyProgress` prop `variant?: 'list' | 'dots'` (default `'list'`, so existing usage is unchanged); action-bar hook classes `.ritual`, `.ritual-top`, `.ritual-body`, `.action-bar`, `.bar-action` used by Task 5's assistant positioning and Task 6's target sweep.

- [ ] **Step 1: `chrome="minimal"` prop in `src/layouts/Layout.astro`**

Extend the Props interface and destructure:

```astro
interface Props {
  title: string;
  description?: string;
  lang: Lang;
  noindex?: boolean;
  chrome?: 'full' | 'minimal';
}
const { title, description = '', lang, noindex = false, chrome = 'full' } = Astro.props;
```

Wrap the nav renders (the `.top-nav` div and the `<MobileNav … />` line) in one condition:

```astro
  {chrome === 'full' && (
    <div class="top-nav">
      {/* …existing nav content, unchanged… */}
    </div>
  )}
  {chrome === 'full' && <MobileNav lang={lang} loggedIn={!!userId} />}
```

(Keep the existing children of `.top-nav` byte-identical — only the wrapping condition is new.)

- [ ] **Step 2: Dots variant in `src/components/DailyProgress.astro`**

Change the Props interface and destructure:

```astro
interface Props {
  reached: Step;
  current: Step;
  lang: Lang;
  variant?: 'list' | 'dots';
}
const { reached, current, lang, variant = 'list' } = Astro.props;
```

Render the dots variant *before* the existing `<nav>` and wrap the existing `<nav>` in the
list branch, so the default stays byte-identical:

```astro
---
// …existing frontmatter, plus `variant = 'list'` in the destructure above…
---
{variant === 'dots' ? (
  <div class="daily-dots" role="img"
    aria-label={lang === 'zh' ? '圣言诵读的步骤' : 'Lectio Divina steps'}>
    {STEP_ORDER.map((s) => {
      const i = stepIndex(s);
      const state = s === current ? 'current' : i < reachedIndex ? 'done' : 'locked';
      return <span class={`ddot ${state}`}></span>;
    })}
  </div>
) : (
  <nav class="daily-progress" aria-label={lang === 'zh' ? '圣言诵读的步骤' : 'Lectio Divina steps'}>
    {/* …existing <ol> and .bar markup, unchanged… */}
  </nav>
)}
```

- [ ] **Step 3: Ritual frame in `src/pages/today/[step].astro`**

3a. Import `stepIndex` in the frontmatter (extend line 12):

```astro
import { isStep, nextStep, STEP_COPY, WRITING_STEPS, stepIndex, type Step } from '../../lib/dailySteps';
```

3b. Change the Layout call (line 129) to:

```astro
<Layout title={`${copy.name[lang]} · ${entry.title[lang]}`} lang={lang} noindex={true} chrome="minimal">
```

3c. Restructure the template. The article becomes a three-part flex column; each step's
`.advance`/submit moves into the bottom `.action-bar`. Replace lines 130-237 with:

```astro
  <article class="daily ritual">
    <header class="ritual-top">
      <DailyProgress reached={reached} current={step} lang={lang} variant="dots" />
      <span class="ritual-count">
        {lang === 'zh' ? `第 ${stepIndex(step) + 1} 步，共 6 步` : `Step ${stepIndex(step) + 1} of 6`}
      </span>
      <a class="ritual-exit" href="/today" aria-label={lang === 'zh' ? '退出本次诵读' : 'Exit this session'}>✕</a>
    </header>

    <div class="ritual-body">
      <header>
        <p class="day">{entry.title[lang]}</p>
        <h1>{copy.name[lang]}</h1>
        <p class="prompt">{copy.prompt[lang]}</p>
        {stepAudio && (
          <button type="button" class="listen" data-clip={stepAudio}
            aria-label={lang === 'zh' ? '朗读引导语' : 'Listen to the guidance'}
          >{lang === 'zh' ? '▶ 引导' : '▶ Guidance'}</button>
        )}
      </header>

      {step === 'silencio' && (
        <section class="silence">
          <div class="timer" data-seconds="60" aria-live="polite"></div>
          {guidedAvailable && (
            <div class="guided">
              <button type="button" class="listen" data-guided={JSON.stringify(guidedItems)}
                aria-label={lang === 'zh' ? '播放整场引导音频' : 'Play the whole guided session'}
              >{lang === 'zh' ? '▶ 整场引导' : '▶ Guided session'}</button>
              <p class="guided-now" data-guided-now hidden aria-live="polite"></p>
              <p class="guided-hint">
                {lang === 'zh' ? '依次朗读六个步骤与经文，之间留出安歇的时间。' : 'Reads the six steps and the passage aloud, with rests between.'}
              </p>
            </div>
          )}
        </section>
      )}

      {step === 'lectio' && (
        <section class="reading">
          <div class="controls" role="group" aria-label={lang === 'zh' ? '字体大小' : 'Text size'}>
            <button type="button" data-scale="-1" aria-label={lang === 'zh' ? '缩小字体' : 'Smaller text'}>A-</button>
            <button type="button" data-scale="0" aria-label={lang === 'zh' ? '默认字体' : 'Default text size'}>A</button>
            <button type="button" data-scale="1" aria-label={lang === 'zh' ? '放大字体' : 'Larger text'}>A+</button>
          </div>
          {passage ? (
            <>
              <p class="ref">{passage.ref}</p>
              <p class="text">{passage.text}</p>
              <button type="button" class="listen" data-listen data-day={day} data-prebuilt={prebuiltPassage}
                aria-label={lang === 'zh' ? '朗读经文' : 'Listen to the passage'}
              >{lang === 'zh' ? '▶ 朗读' : '▶ Listen'}</button>
              <p class="twice">{lang === 'zh' ? '请再读一遍。' : 'Now read it a second time.'}</p>
            </>
          ) : (
            <p class="text">
              {lang === 'zh' ? '今天的经文暂时无法显示。' : "Today's passage could not be loaded."}
            </p>
          )}
        </section>
      )}

      {step === 'contemplatio' && (
        <section class="rest">
          {priorText('oratio') && <blockquote class="own-words mine">{priorText('oratio')}</blockquote>}
          <div class="timer" data-seconds="120" aria-live="polite"></div>
        </section>
      )}

      {isWriting && (
        <section class="writing">
          {step === 'meditatio' && passage && <p class="text passage-again">{passage.text}</p>}
          {step !== 'meditatio' && priorText('meditatio') && (
            <blockquote class="own-words">{priorText('meditatio')}</blockquote>
          )}

          {saved && myEntry ? (
            <>
              <blockquote class="own-words mine">{myEntry.userText}</blockquote>
              {myEntry.aiText
                ? (
                  <>
                    <p class="reply">{myEntry.aiText}</p>
                    <button type="button" class="listen" data-reply data-day={day} data-step={step}
                      aria-label={lang === 'zh' ? '朗读回复' : 'Listen to the reply'}
                    >{lang === 'zh' ? '▶ 听回复' : '▶ Reply'}</button>
                  </>
                )
                : <p class="reply muted">{copy.prompt[lang]}</p>}
            </>
          ) : (
            <form method="post" id="step-form">
              <label for="step_text">{copy.prompt[lang]}</label>
              {/* A textarea's value is its children, never a value attribute. */}
              <textarea
                id="step_text"
                name="step_text"
                rows="5"
                maxlength={STEP_TEXT_MAX_CHARS}
                required
              >{myEntry?.userText ?? ''}</textarea>
              {submitError === 'empty' && (
                <p class="error">{lang === 'zh' ? '请先写下一点什么。' : 'Write something first.'}</p>
              )}
            </form>
          )}
        </section>
      )}
    </div>

    <div class="action-bar">
      {step === 'silencio' && (
        <a class="advance bar-action" href={advanceHref}>{lang === 'zh' ? '开始' : 'Begin'}</a>
      )}
      {step === 'lectio' && (
        <a class="advance bar-action ready" href={advanceHref}>{continueLabel}</a>
      )}
      {step === 'contemplatio' && (
        <a class="advance bar-action" href={advanceHref}>{continueLabel}</a>
      )}
      {isWriting && saved && (
        <a class="advance ready bar-action" href={advanceHref}>{continueLabel}</a>
      )}
      {isWriting && !saved && (
        <button type="submit" form="step-form" class="bar-action">{continueLabel}</button>
      )}
    </div>
  </article>
```

3d. In the `<script>` block, the timer-finish callback must light the bar instead of the
section (the advance link no longer lives inside the section). Change
`el.closest('section')?.classList.add('ready');` to:

```ts
        el.closest('section')?.classList.add('ready');
        document.querySelector('.action-bar')?.classList.add('ready');
```

3e. Replace the `.daily` / add ritual styles in the page's `<style>` block. Keep every
existing rule that styles `.day`, `h1`, `.prompt`, `.text`, `.listen`, `.timer`,
`.own-words`, `.reply`, `.writing *`, `.error`, `.guided*`, `.controls` unchanged; add:

```css
  .ritual {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 40px); /* body padding: 20px top + 20px bottom */
    min-height: calc(100dvh - 40px);
    padding: 0 1.25rem;
  }
  .ritual-top {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: max(10px, env(safe-area-inset-top)) 0 6px;
    position: sticky; top: 0; z-index: 10;
    background: var(--bg);
  }
  .ritual-count { font-size: 0.75rem; opacity: 0.55; white-space: nowrap; }
  .ritual-exit {
    color: var(--text-dim); text-decoration: none; font-size: 13px;
    border: 1px solid var(--panel-border); border-radius: 8px;
    min-width: 44px; min-height: 44px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .ritual-exit:hover { color: var(--text); }
  .ritual-body { flex: 1 1 auto; }
  .action-bar {
    position: sticky; bottom: 0; z-index: 10;
    margin-top: auto; padding: 10px 0 max(12px, env(safe-area-inset-bottom));
    background: linear-gradient(transparent, var(--bg) 30%);
  }
  .action-bar .advance { opacity: 0.35; }
  .action-bar.ready .advance,
  .action-bar .advance.ready { opacity: 1; }
  .bar-action {
    display: block; width: 100%; text-align: center;
    background: var(--gold); color: #1c1503;
    font-size: 16px; font-weight: 600; font-family: inherit;
    padding: 14px; min-height: 52px;
    border: none; border-radius: 14px; text-decoration: none; cursor: pointer;
  }
  .daily-dots { display: flex; gap: 6px; align-items: center; }
  .ddot { width: 8px; height: 8px; border-radius: 50%; background: var(--panel-border); }
  .ddot.done { background: var(--gold); }
  .ddot.current { background: transparent; border: 2px solid var(--gold); }
```

and adjust the old advance rule so it no longer fights the bar (the `.advance` base rule
keeps its `opacity/transition`; its inline-block padding rule stays for safety but is
overridden by `.bar-action`):

```css
  .ritual .advance {
    display: flex; align-items: center; justify-content: center;
    margin-top: 0; padding: 0 1.5rem;
    border: none; border-radius: 14px;
  }
```

- [ ] **Step 4: Amen page frame in `src/pages/today/amen.astro`**

Change the Layout call to `chrome="minimal"` and wrap the article in the ritual frame:

```astro
<Layout title={`${entry.title[lang]} · Amen`} lang={lang} noindex={true} chrome="minimal">
  <article class="amen ritual">
    <header class="ritual-top">
      <span class="daily-dots" aria-hidden="true">
        <span class="ddot done"></span><span class="ddot done"></span><span class="ddot done"></span>
        <span class="ddot done"></span><span class="ddot done"></span><span class="ddot done"></span>
      </span>
      <a class="ritual-exit" href="/" aria-label={lang === 'zh' ? '返回首页' : 'Back to the home page'}>✕</a>
    </header>

    <div class="ritual-body">
      {/* …the existing <header>, passage text, empty state and entries sections, unchanged… */}
    </div>

    <nav class="action-bar">
      {!finished && <a class="bar-action" href="/today">{lang === 'zh' ? '继续今天的诵读' : 'Continue today'}</a>}
      {finished && <a class="bar-action" href="/">{lang === 'zh' ? '返回首页' : 'Return home'}</a>}
      <a class="amen-secondary" href="/history">{lang === 'zh' ? '查看过往' : 'See past days'}</a>
    </nav>
  </article>
</Layout>
```

In its `<style>`, delete the old `.after` rule and add:

```css
  .amen-secondary {
    display: block; text-align: center; margin-top: 6px;
    color: var(--text-dim); text-decoration: none; font-size: 0.9rem;
    min-height: 44px; line-height: 44px;
  }
  .amen-secondary:hover { color: var(--text); }
```

(`.amen` already carries `max-width: 38rem; margin: 0 auto;` — add `padding: 0 1.25rem;`
to it, replacing the old `2.5rem 1.25rem 4rem`, and rely on `.ritual` for the flex frame.)

- [ ] **Step 5: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; all tests pass (the daily-session tests do not touch markup);
build succeeds.

Manual (`npx wrangler dev`, 375px viewport):
- `/today/silencio` (anonymous): no site nav anywhere; six dots with #1 current; "Step 1 of 6" / 第 1 步，共 6 步; Begin is a gold bar pinned above the home indicator; the bar's opacity lifts when the 60s timer ends (and is already full for `lectio` via `ready`).
- Signed-in `/today/meditatio`: the submit button is the gold bar; submitting an empty form still shows 请先写下一点什么。inside the form; after save, the bar becomes Continue.
- `/today/contemplatio`: 120s timer lights the bar.
- `/today/amen`: six gold dots, primary bar is 继续今天的诵读 or 返回首页, See past days is the secondary link.
- Desktop (1280px): the ritual pages also show no `.top-nav` (intended — chrome="minimal") and the layout is a centered column.
- ✕ exits to `/today` (steps) or `/` (amen) without losing progress: after exiting mid-walk, `/today` reopens at the reached step.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/Layout.astro src/components/DailyProgress.astro src/pages/today/[step].astro src/pages/today/amen.astro src/styles/global.css
git commit -m "feat(mobile): ritual mode — chrome-free steps, bottom-anchored action (M-02)"
```

---

### Task 4: Safe areas + dvh for the remaining overlays (Spec §4.4, M-04)

**Files:**
- Modify: `src/styles/global.css` (`.loading-overlay`, `.gate-modal-backdrop`)

**Interfaces:**
- Consumes: nothing new.
- Produces: overlay geometry that respects notches/home-indicator (Task 7 deletes the loader element but keeps the class; the gate modal changes stand alone).

- [ ] **Step 1: Fix the loader overlay geometry**

In `src/styles/global.css`, change `.loading-overlay` (lines 149-152) to:

```css
.loading-overlay {
  position: fixed; top: 0; left: 0; width: 100%;
  height: 100vh; height: 100dvh;
  background: var(--overlay-bg); display: none; justify-content: center; align-items: center; z-index: 1000;
  padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
}
```

- [ ] **Step 2: Fix the gate modal geometry**

Change `.gate-modal-backdrop` (lines 470-476): keep `position: fixed; inset: 0; z-index: 100;` and the rest, but replace its `padding: 18px;` with:

```css
  padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
```

- [ ] **Step 3: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; tests pass; build succeeds.

Manual: in devtools, enable a notch device (e.g. iPhone 14 Pro) for `/today/silencio` as an anonymous visitor, press the Reflect button to open the gate modal — its content clears the home indicator; the modal is dismissible.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(mobile): safe-area + dvh geometry for loader and gate modal (M-04)"
```

---

### Task 5: Assistant widget — z-order, safe area, writing-step geometry (Spec §4.6, M-06)

**Files:**
- Modify: `src/components/AssistantWidget.astro` (styles + a 5-line positioning script)

**Interfaces:**
- Consumes: the `.ritual .writing` hook and `.action-bar` from Task 3.
- Produces: `#assistant-root.above-action` class (set by script when the page has a ritual writing section) that later tasks may rely on; z-index 60 per the global contract.

- [ ] **Step 1: Z-index + safe area**

In the `<style>` block, change `#assistant-root` (line 337-340) to:

```css
  #assistant-root {
    position: fixed; left: 18px; right: 18px;
    bottom: calc(18px + env(safe-area-inset-bottom));
    z-index: 60;
    pointer-events: none;
  }
```

- [ ] **Step 2: Writing-step geometry**

Add to the `<style>` block:

```css
  /* Ritual writing steps: never cover the action bar; icon-only launcher. */
  #assistant-root.above-action { bottom: calc(84px + env(safe-area-inset-bottom)); }
  #assistant-root.above-action #assistant-bubble .assistant-bubble-label { display: none; }
  #assistant-root.above-action #assistant-bubble { padding: 0 16px; }
```

- [ ] **Step 3: Set the class from script**

At the top of the widget's `<script>` (after the element lookups, ~line 122), add:

```ts
  // On ritual writing steps the launcher must never cover the gold action bar:
  // lift it above the bar and collapse it to an icon-only tab.
  if (document.querySelector('.ritual .writing')) {
    document.getElementById('assistant-root')?.classList.add('above-action');
  }
```

- [ ] **Step 4: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; tests pass; build succeeds.

Manual: on `/today/meditatio` (signed in, 375px), the assistant bubble is icon-only and sits above the gold Continue bar; opening the panel never overlaps the bar (panel bottom ≥ bar top). On `/`, the bubble renders with its "提问 / Ask a question" label as before. The gate modal (z 100) still covers the assistant (z 60) when both are visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/AssistantWidget.astro
git commit -m "feat(mobile): assistant below modals/action bar, safe-area offset (M-06)"
```

---

### Task 6: Touch targets + input zoom sweep (Spec §4.5, M-05)

**Files:**
- Modify: `src/styles/global.css` (nav links, follow-up questions, filters, billing toggle, gate "later", auth inputs)
- Modify: `src/pages/today/[step].astro` (`.listen`, `.controls button`)

**Interfaces:**
- Consumes: nothing new. Produces nothing downstream.

- [ ] **Step 1: Targets in `src/styles/global.css`**

Change `.top-nav a` (lines 58-64) to:

```css
.top-nav a {
  color: var(--text-dim);
  text-decoration: none;
  margin-left: 10px;
  font-size: 14px;
  display: inline-flex; align-items: center; min-height: 44px;
}
```

Change `.follow-up-question` (lines 111-115) padding to `10px 18px;` and add
`min-height: 44px; display: inline-flex; align-items: center;` to the same rule.

Change `.filters a` (lines 190-193) to add
`display: inline-flex; align-items: center; min-height: 44px;`.

Change `.billing-toggle-btn` (lines 397-401) padding to `10px 22px;` and add
`min-height: 44px;`.

Change `.gate-modal-later` (lines 498-502) to add
`min-height: 44px; display: inline-flex; align-items: center;`.

Change `.auth-card input` (lines 233-236) `font-size: 15px` → `font-size: 16px`
(iOS zooms any focusable input below 16px).

- [ ] **Step 2: Targets in `src/pages/today/[step].astro`**

Change `.listen` (lines 505-514) to:

```css
  .listen {
    display: block;
    margin: 0 auto;
    background: none;
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 999px;
    padding: 0 1.2rem;
    min-height: 44px;
    font-size: 0.85rem;
    cursor: pointer;
  }
```

Change `.controls button` (lines 516-524) to add
`min-width: 44px; min-height: 44px;` (keep the existing padding/border/font rules).

- [ ] **Step 3: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; tests pass; build succeeds.

Manual: at 375px, hover-tap each control on `/`, `/library`, `/pricing`, `/login`,
`/today/lectio` — none feel cramped; focusing the email input on `/login` in a real iOS
Safari (or devtools device emulation) does not zoom the page; desktop layout of the
touched components is visually unchanged (min-heights are below their current heights
except where noted).

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css src/pages/today/[step].astro
git commit -m "feat(mobile): 44px touch targets + 16px inputs site-wide (M-05)"
```

---

### Task 7: Inline shimmer loader replaces the blocking overlay (Spec §4.7, M-07)

**Files:**
- Modify: `src/pages/index.astro` (delete overlay markup; add wait panel; rewrite `showLoading()`)
- Modify: `src/styles/global.css` (wait-panel styles; reduced-motion for shimmer lines; loader CSS removed)

**Interfaces:**
- Consumes: the existing `.teaser-line` shimmer CSS (`global.css:454-462`) and its width modifier classes.
- Produces: `#wait-panel` + `#wait-text` hooks on `index.astro`; `showLoading()` now toggles the panel instead of the overlay.

- [ ] **Step 1: Delete the overlay markup**

Remove the whole `<div class="loading-overlay" id="loading-overlay">…</div>` block
(`src/pages/index.astro:504-509`).

- [ ] **Step 2: Add the inline wait panel**

Insert immediately after the closing `</form>` of `#reading-form` (line 626):

```html
  <div class="wait-panel" id="wait-panel" hidden role="status" aria-live="polite">
    <p class="wait-title" id="wait-text">
      {lang === 'zh' ? '正在为你领受经文，请稍候...' : 'Receiving your verses, please wait...'}
    </p>
    <div class="teaser-line w85"></div>
    <div class="teaser-line w70"></div>
    <div class="teaser-line w60"></div>
  </div>
```

- [ ] **Step 3: Rewrite `showLoading()`**

Replace the `showLoading` function (lines 926-929) with:

```ts
    function showLoading() {
      const panel = document.getElementById('wait-panel');
      if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
```

Keep the `interpret-form` submit handler (lines 992-1000) exactly as is — its
`loading-text` update becomes:

```ts
      const text = document.getElementById('wait-text');
      if (text) {
        text.textContent = document.documentElement.lang === 'zh'
          ? '正在写下默想，请稍候...'
          : 'Writing your reflection, please wait...';
      }
```

(the only change is the element id; also reset it back to the default text in the main
`reading-form` submit listener so a second draw shows the right words):

```ts
    document.getElementById('reading-form')?.addEventListener('submit', () => {
      const text = document.getElementById('wait-text');
      if (text) {
        text.textContent = document.documentElement.lang === 'zh'
          ? '正在为你领受经文，请稍候...'
          : 'Receiving your verses, please wait...';
      }
      showLoading();
    });
```

(replacing the bare `showLoading` reference on line 931).

- [ ] **Step 4: Styles**

Append to `src/styles/global.css`:

```css
/* ---------- Inline wait panel (M-07) ---------- */
.wait-panel {
  margin: 24px auto 10px; max-width: 640px; text-align: center;
  background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 12px; padding: 24px 22px;
}
.wait-panel[hidden] { display: none; }
.wait-title { margin: 0 0 14px; color: var(--gold); font-size: 15px; }
@media (prefers-reduced-motion: reduce) {
  .teaser-line { animation: none !important; }
}
```

Then delete the now-dead rules `.loading-overlay`, `.loading-content`, `.loading-spinner`,
and `@keyframes spin` (lines 149-161), and update the `.teaser-line` width classes
(`.w85/.w70/.w90/.w60`, lines 461-462) — they already exist and are reused as-is; no change
needed to them.

- [ ] **Step 5: Verify**

Run: `npx astro check && npm test && npm run build`
Expected: no new errors; tests pass; build succeeds.

Manual: on `/`, submit a draw — the page does NOT freeze; the verse/parchment result area
keeps the last content and a shimmer panel appears (scrolls into view) until the POST
returns with the real reading. Submitting the Reflect form (registered) shows the
"Writing your reflection" text in the same panel. With reduced-motion enabled the shimmer
bars are static. No element covers the viewport at any point.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro src/styles/global.css
git commit -m "feat(mobile): inline shimmer wait panel replaces blocking loader (M-07)"
```

---

### Task 8: Full verification matrix + docs

**Files:**
- Modify: `memory/2026-09-06.md` (session note)

**Interfaces:** none — verification only.

- [ ] **Step 1: Full automated pass**

Run: `npm test && npx astro check && npm run build`
Expected: all tests green; no new astro errors; build succeeds (kill any orphaned
`workerd.exe` and `rm -rf dist` first if the build complains about a held dist folder —
known local gotcha).

- [ ] **Step 2: Manual matrix (`npx wrangler dev`)**

For pages `/`, `/today/silencio` → `/today/amen`, `/library`, `/pricing`, `/login`,
`/account`, at 320px, 375px, 430px, dark + light, en + zh:
- No horizontal overflow (body scroll width equals viewport width).
- The primary action is reachable without hunting (Today pill on every chrome page; gold bar in ritual mode).
- Sheet, gate modal, assistant, wait panel all respect safe areas on a notched device profile.
- A/B intact: `/login` still renders both `signup_cta_copy` variants per bucket (check the `ab` cookie and the CTA copy differs between two distinct visitor cookies).
- Analytics intact: clicking the Today pill fires `cta_click` with `slot: nav_today` (Network tab, `/api/analytics/collect` beacon).
- Bible-opening animation on `/` (anonymous, multi-verse draw) unchanged; reduced-motion path unchanged.
- Lighthouse mobile run on `/today/silencio`: PWA "Installable"; no horizontal overflow at 320px.

- [ ] **Step 3: Record and commit**

Write a short summary to `memory/2026-09-06.md` (what shipped, verification results, any
deviations). Commit:

```bash
git add memory/2026-09-06.md
git commit -m "docs: mobile usability implementation notes"
```

Do NOT deploy (`npx wrangler deploy`) unless the user asks.
