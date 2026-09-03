# Consistent Language Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user's language choice (中文/English) persist across all pages, with a shared switcher in the layout nav.

**Architecture:** A new `src/lib/i18n.ts` resolves language as `?lang` param → `lang` cookie → default `zh`, persisting any explicit param into a 1-year cookie. All 9 SSR pages adopt the helper and pass `lang` to `Layout`, which renders a site-wide switcher and a dynamic `<html lang>`. Per-page duplicate switchers are removed.

**Tech Stack:** Astro 7 (SSR on Cloudflare Workers), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-language-switching-consistency-design.md`

---

### Task 1: `resolveLang` helper (TDD)

**Files:**
- Create: `src/lib/i18n.ts`
- Test: `src/lib/__tests__/i18n.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveLang } from '../i18n';

interface CookieOp {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

function makeAstro(params: Record<string, string>, cookies: Record<string, string> = {}) {
  const setCalls: CookieOp[] = [];
  return {
    astro: {
      url: new URL(`https://example.com/?${new URLSearchParams(params).toString()}`),
      cookies: {
        get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined),
        set: (name: string, value: string, options: Record<string, unknown>) => {
          setCalls.push({ name, value, options });
        },
      },
    },
    setCalls,
  };
}

describe('resolveLang', () => {
  it('defaults to zh with no param and no cookie', () => {
    const { astro } = makeAstro({});
    expect(resolveLang(astro)).toBe('zh');
  });

  it('prefers a valid ?lang param over the cookie', () => {
    const { astro } = makeAstro({ lang: 'en' }, { lang: 'zh' });
    expect(resolveLang(astro)).toBe('en');
  });

  it('falls back to the lang cookie when no param is present', () => {
    const { astro } = makeAstro({}, { lang: 'en' });
    expect(resolveLang(astro)).toBe('en');
  });

  it('ignores invalid param and cookie values', () => {
    expect(resolveLang(makeAstro({ lang: 'fr' }).astro)).toBe('zh');
    expect(resolveLang(makeAstro({}, { lang: 'garbage' }).astro)).toBe('zh');
    expect(resolveLang(makeAstro({ lang: 'fr' }, { lang: 'en' }).astro)).toBe('en');
  });

  it('persists a valid param into the lang cookie', () => {
    const { astro, setCalls } = makeAstro({ lang: 'en' });
    resolveLang(astro);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].name).toBe('lang');
    expect(setCalls[0].value).toBe('en');
    expect(setCalls[0].options).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 31536000,
    });
  });

  it('does not write the cookie when no valid param is present', () => {
    const { astro, setCalls } = makeAstro({}, { lang: 'en' });
    resolveLang(astro);
    expect(setCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/i18n.test.ts`
Expected: FAIL — cannot resolve `../i18n`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/i18n.ts`:

```ts
// Language resolution and persistence.
// Priority: explicit ?lang= param (persisted to cookie) > lang cookie > 'zh'.
import type { Lang } from './tarot';

const LANG_COOKIE = 'lang';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isLang(v: string | null | undefined): v is Lang {
  return v === 'zh' || v === 'en';
}

// Structural subset of the Astro page context we need — keeps this module
// unit-testable without the full Astro types.
interface LangRequestContext {
  url: URL;
  cookies: {
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options: Record<string, unknown>): void;
  };
}

export function resolveLang(astro: LangRequestContext): Lang {
  const param = astro.url.searchParams.get('lang');
  if (isLang(param)) {
    astro.cookies.set(LANG_COOKIE, param, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ONE_YEAR_SECONDS,
    });
    return param;
  }
  const cookie = astro.cookies.get(LANG_COOKIE)?.value;
  if (isLang(cookie)) return cookie;
  return 'zh';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/i18n.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts src/lib/__tests__/i18n.test.ts
git commit -m "feat(i18n): add resolveLang with cookie persistence"
```

---

### Task 2: `langSwitchHref` helper (TDD)

**Files:**
- Modify: `src/lib/i18n.ts`
- Test: `src/lib/__tests__/i18n.test.ts`

- [ ] **Step 1: Append the failing tests** to `src/lib/__tests__/i18n.test.ts` (add `langSwitchHref` to the import):

```ts
describe('langSwitchHref', () => {
  it('sets lang on the current path', () => {
    const { astro } = makeAstro({}, { lang: 'zh' });
    astro.url = new URL('https://example.com/pricing');
    expect(langSwitchHref(astro, 'en')).toBe('/pricing?lang=en');
  });

  it('preserves other query params and replaces an existing lang', () => {
    const { astro } = makeAstro({ lang: 'zh', suit: 'cups' });
    astro.url = new URL('https://example.com/library?suit=cups&lang=zh');
    expect(langSwitchHref(astro, 'en')).toBe('/library?suit=cups&lang=en');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/i18n.test.ts`
Expected: FAIL — `langSwitchHref` is not exported.

- [ ] **Step 3: Implement** — append to `src/lib/i18n.ts`:

```ts
// href for the nav language switcher: stay on the current page, swap lang,
// keep all other query params.
export function langSwitchHref(astro: LangRequestContext, target: Lang): string {
  const params = new URLSearchParams(astro.url.searchParams);
  params.set('lang', target);
  return `${astro.url.pathname}?${params.toString()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/i18n.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts src/lib/__tests__/i18n.test.ts
git commit -m "feat(i18n): add langSwitchHref for the nav switcher"
```

---

### Task 3: Layout — `lang` prop, dynamic `<html lang>`, shared switcher

**Files:**
- Modify: `src/layouts/Layout.astro`

Note: after this task, every page MUST pass `lang` — pages are migrated in Tasks 4–8. `npm run build` will fail until all pages are updated; verify with `npm run dev` + per-page curl instead of a full build until Task 8.

- [ ] **Step 1: Rewrite `src/layouts/Layout.astro`**

```astro
---
import '../styles/global.css';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from '../lib/session';
import { langSwitchHref } from '../lib/i18n';
import type { Lang } from '../lib/tarot';

interface Props {
  title: string;
  lang: Lang;
}
const { title, lang } = Astro.props;

const sessionCookie = Astro.cookies.get('session')?.value;
const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;
---
<!DOCTYPE html>
<html lang={lang}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <title>{title}</title>
</head>
<body>
  <div class="top-nav">
    {userId ? (
      <a href="/account">{lang === 'zh' ? '账户' : 'Account'}</a>
    ) : (
      <a href="/login">{lang === 'zh' ? '登录' : 'Log in'}</a>
    )}
    <a href="/pricing">{lang === 'zh' ? '价格' : 'Pricing'}</a>
    <a href="/privacy">{lang === 'zh' ? '隐私' : 'Privacy'}</a>
    <a href={langSwitchHref(Astro, 'zh')} style={lang === 'zh' ? 'font-weight: bold;' : undefined}>中文</a>
    <a href={langSwitchHref(Astro, 'en')} style={lang === 'en' ? 'font-weight: bold;' : undefined}>English</a>
  </div>
  <slot />
</body>
</html>
```

Notes:
- Nav links (`/account`, `/login`, `/pricing`, `/privacy`) intentionally carry no `?lang=` — the cookie fallback handles them. Labels are translated since the nav is now language-aware.
- Existing `.top-nav a` CSS in `src/styles/global.css` already styles these links; no CSS changes needed.

- [ ] **Step 2: Commit (do not build yet)**

```bash
git add src/layouts/Layout.astro
git commit -m "feat(layout): add lang prop, shared language switcher, dynamic html lang"
```

---

### Task 4: Migrate homepage (`index.astro`)

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace the inline language line**

In the frontmatter, replace:

```ts
const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as Lang;
```

with:

```ts
import { resolveLang } from '../lib/i18n';

const url = Astro.url;
const lang = resolveLang(Astro);
```

(`Lang` stays imported from `../lib/tarot` — it is still used by `langSwitchHref(target: Lang)`.)

- [ ] **Step 2: Remove the duplicate switcher block**

Delete the entire block:

```html
  <div class="language-switcher">
    <a href={`/library?lang=${lang}`}>{lang === 'zh' ? '塔罗牌库' : 'Card Library'}</a>
    <a href={langSwitchHref('zh')} style={lang === 'zh' ? 'font-weight: bold;' : undefined}>中文</a>
    <a href={langSwitchHref('en')} style={lang === 'en' ? 'font-weight: bold;' : undefined}>English</a>
  </div>
```

and replace it with the library link only:

```html
  <div class="language-switcher">
    <a href="/library">{lang === 'zh' ? '塔罗牌库' : 'Card Library'}</a>
  </div>
```

The page-local `langSwitchHref(target: Lang)` function in the frontmatter has no remaining references after this deletion — **delete it as well** (the shared nav uses the `i18n.ts` version).

- [ ] **Step 3: Pass `lang` to Layout**

Change `<Layout title={title}>` to `<Layout title={title} lang={lang}>`.

- [ ] **Step 4: Verify**

Run: `npm run dev`, then in another shell:

```bash
curl -s 'http://localhost:4321/?lang=en' | grep -o '<html lang="en">'
curl -s 'http://localhost:4321/?lang=en' | grep -o 'Inspiration Tarot' | head -1
```

Expected: both lines print. Also click 中文/English in the nav in a browser and confirm the URL stays on `/` and the page re-renders in the chosen language.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(home): adopt resolveLang, remove duplicate switcher"
```

---

### Task 5: Migrate auth pages (`login.astro`, `signup.astro`)

**Files:**
- Modify: `src/pages/login.astro`
- Modify: `src/pages/signup.astro`

Apply the identical 2-edit pattern to **each** file:

- [ ] **Step 1: Replace the inline language line**

Replace:

```ts
const url = Astro.url;
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';
```

with (add the import near the other imports):

```ts
import { resolveLang } from '../lib/i18n';

const url = Astro.url;
const lang = resolveLang(Astro);
```

(`const url = Astro.url;` stays — both pages still read `url.searchParams.get('error')`.)

- [ ] **Step 2: Pass `lang` to Layout**

- `login.astro`: `<Layout title={lang === 'zh' ? '登录' : 'Log in'} lang={lang}>`
- `signup.astro`: keep its existing title expression and add `lang={lang}`.

- [ ] **Step 3: Verify the persistence scenario end-to-end**

Run: `npm run dev`, then:

```bash
curl -s -c /tmp/inspire-cookies.txt 'http://localhost:4321/?lang=en' > /dev/null
curl -s -b /tmp/inspire-cookies.txt 'http://localhost:4321/signup' | grep -o '<html lang="en">'
curl -s -b /tmp/inspire-cookies.txt 'http://localhost:4321/login' | grep -o 'Welcome back'
```

Expected: `<html lang="en">` on signup, `Welcome back` on login — **with no `?lang=` in those URLs**. This is the exact scenario from the original bug report.

- [ ] **Step 4: Commit**

```bash
git add src/pages/login.astro src/pages/signup.astro
git commit -m "feat(auth): adopt resolveLang for login/signup"
```

---

### Task 6: Migrate `pricing.astro`, `account.astro`, `history/index.astro`

**Files:**
- Modify: `src/pages/pricing.astro`
- Modify: `src/pages/account.astro`
- Modify: `src/pages/history/index.astro`

- [ ] **Step 1: Same 2-edit pattern per file**

Replace in each file:

```ts
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as 'en' | 'zh';
```

with `const lang = resolveLang(Astro);` plus the import:
- `pricing.astro`: `import { resolveLang } from '../lib/i18n';`
- `account.astro`: `import { resolveLang } from '../lib/i18n';`
- `history/index.astro`: `import { resolveLang } from '../../lib/i18n';`

Keep `const url = Astro.url;` (still used in `account.astro` for the `welcome` param).

- [ ] **Step 2: Pass `lang` to Layout in each file**

- `pricing.astro`: `<Layout title={lang === 'zh' ? '价格' : 'Pricing'} lang={lang}>`
- `account.astro`: `<Layout title={lang === 'zh' ? '账户' : 'Account'} lang={lang}>`
- `history/index.astro`: `<Layout title={lang === 'zh' ? '历史记录' : 'History'} lang={lang}>`

- [ ] **Step 3: Verify**

```bash
curl -s -b /tmp/inspire-cookies.txt 'http://localhost:4321/pricing' | grep -o '<html lang="en">'
```

Expected: prints `<html lang="en">` (cookie from Task 5 step 3 carries the language).
`/account` and `/history` redirect when logged out — that's fine; they are covered by the Task 8 smoke test.

- [ ] **Step 4: Commit**

```bash
git add src/pages/pricing.astro src/pages/account.astro src/pages/history/index.astro
git commit -m "feat: adopt resolveLang for pricing/account/history"
```

---

### Task 7: Migrate library pages + privacy (helpers, switcher removal, copy)

**Files:**
- Modify: `src/pages/library/index.astro`
- Modify: `src/pages/library/[slug].astro`
- Modify: `src/pages/privacy.astro`

- [ ] **Step 1: `library/index.astro`**

Replace:

```ts
const lang = (url.searchParams.get('lang') === 'en' ? 'en' : 'zh') as Lang;
```

with `const lang = resolveLang(Astro);` plus `import { resolveLang } from '../../lib/i18n';`.
(Keep the `type Lang` import from `../../lib/tarot` — `getLibraryCards` typing still relies on it being in scope only if referenced; if unused after the edit, remove it. It remains used nowhere else in this file, so change the tarot import to `import { getLibraryCards } from '../../lib/tarot';`.)

Replace the duplicate nav block:

```html
  <div class="top-nav">
    <a href={`/?lang=zh`}>{lang === 'zh' ? '占卜首页' : 'Reading Home'}</a>
    <a href={`?lang=zh&suit=${suit}`} style={lang === 'zh' ? 'font-weight: bold;' : undefined}>中文</a>
    <a href={`?lang=en&suit=${suit}`} style={lang === 'en' ? 'font-weight: bold;' : undefined}>English</a>
  </div>
```

with a home link only:

```html
  <div class="top-nav">
    <a href="/">{lang === 'zh' ? '占卜首页' : 'Reading Home'}</a>
  </div>
```

Change `filterHref` to stop pinning lang explicitly (cookie carries it; the param is still fine to keep — keep it as-is to preserve the active-filter round-trip):

No change to `filterHref` — `?lang=${lang}&suit=…` remains correct.

Pass `lang` to Layout: `<Layout title={title} lang={lang}>`.

- [ ] **Step 2: `library/[slug].astro`**

Same helper swap (import path `../../lib/i18n`; change tarot import to `import { getLibraryCards } from '../../lib/tarot';`).

Replace the duplicate nav block:

```html
  <div class="top-nav">
    <a href={`/?lang=zh`}>{lang === 'zh' ? '占卜首页' : 'Reading Home'}</a>
    <a href={`/library/${card.slug}?lang=zh`} style={lang === 'zh' ? 'font-weight: bold;' : undefined}>中文</a>
    <a href={`/library/${card.slug}?lang=en`} style={lang === 'en' ? 'font-weight: bold;' : undefined}>English</a>
  </div>
```

with:

```html
  <div class="top-nav">
    <a href="/">{lang === 'zh' ? '占卜首页' : 'Reading Home'}</a>
  </div>
```

Pass `lang` to Layout: `<Layout title={title} lang={lang}>`.

- [ ] **Step 3: `privacy.astro`**

Helper swap (`import { resolveLang } from '../lib/i18n';`). Delete `const toggleLang = lang === 'zh' ? 'en' : 'zh';` (line 7) and the inline toggle link:

```html
      <a class="policy-lang" href={`/privacy?lang=${toggleLang}`}>
        {lang === 'zh' ? 'Switch to English' : '切换到中文'}
      </a>
```

Update the cookies section copy (`s5body`) in both languages to include the language-preference cookie:

```ts
  s5body: lang === 'zh'
    ? '我们仅使用必要的 Cookie：登录会话 Cookie（保持登录状态，约 30 天）、语言偏好 Cookie（记住你选择的界面语言，约 1 年）、OAuth 登录过程中的一次性 state 语言 Cookie（10 分钟内自动失效），以及一个匿名客户端标识（用于未登录用户的额度控制）。我们不使用广告或追踪 Cookie。'
    : 'We only use essential cookies: a sign-in session cookie (keeps you logged in, ~30 days), a language-preference cookie (remembers your chosen display language, ~1 year), one-time OAuth state/language cookies (expire within 10 minutes), and an anonymous client identifier (quota control for signed-out users). We do not use advertising or tracking cookies.',
```

Pass `lang` to Layout: `<Layout title={t.title} lang={lang}>`.

- [ ] **Step 4: Verify**

```bash
curl -s -b /tmp/inspire-cookies.txt 'http://localhost:4321/library' | grep -o '<html lang="en">'
curl -s -b /tmp/inspire-cookies.txt 'http://localhost:4321/privacy' | grep -o 'language-preference cookie'
```

Expected: both print.

- [ ] **Step 5: Commit**

```bash
git add src/pages/library src/pages/privacy.astro
git commit -m "feat: adopt resolveLang on library/privacy, remove duplicate switchers, update cookie copy"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: all tests pass (existing suites + new i18n suite).

- [ ] **Step 2: Type check**

Run: `npx astro check`
Expected: 0 errors. (If `astro check` reports pre-existing errors unrelated to this change, note them and confirm the new/modified files are clean.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Browser smoke test**

Run `npm run dev` and manually verify:

1. Fresh browser (no cookies) loads `/` in Chinese (default).
2. Click **English** in the top nav → homepage renders English, URL is `/?lang=en`.
3. Click **Pricing** / **Privacy** in the nav (no `?lang=` in those links) → still English.
4. Navigate to **Sign up** and **Log in** → still English.
5. Open **Card Library**, click a card → still English.
6. Switch to **中文** on any page → whole site back to Chinese; reopen the browser / visit `/` directly → still Chinese (cookie).
7. Visit `/?lang=en` directly → English (param overrides and refreshes cookie).
8. Submit the tarot form with an empty question → error message renders in the current language.

- [ ] **Step 5: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "fix(i18n): address verification findings"
```

(Skip if nothing needed.)

---

## Self-Review Notes

- **Spec coverage:** §1 helper → Tasks 1–2; §2 page adoption → Tasks 4–7; §3 Layout switcher → Task 3; §4 duplicate removal → Tasks 4, 7; §5 OAuth compatibility → untouched by design (verified in review: `start.ts`/`callback.ts` unchanged); §6 privacy copy → Task 7 Step 3; Testing section → Tasks 1–2 unit tests + Task 8 smoke.
- **Type consistency:** `resolveLang(astro)` / `langSwitchHref(astro, target)` signatures identical across tasks; `Lang` always from `src/lib/tarot`.
- **Risk:** Layout becomes `lang`-required in Task 3 before pages are migrated (Task 3 note) — dev-server verification per task, full build only in Task 8.
