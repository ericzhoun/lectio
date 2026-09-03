# Consistent Language Switching — Design

Date: 2026-08-29
Status: Approved (brainstorming)

## Problem

Language selection is driven solely by the `?lang=` URL query parameter (default: `zh`),
read inline in each page's frontmatter (`url.searchParams.get('lang')`). The homepage
language switcher only rewrites the current page's URL. Many links carry `?lang=` manually,
but not all of them — notably the shared nav in `src/layouts/Layout.astro` (Account/Login,
Pricing, Privacy) carries no lang at all, and `library/index.astro` / `library/[slug].astro`
hardcode `/?lang=zh` for the home link. Result: switching to English on the homepage and
navigating to signup (or any other page) snaps back to Chinese.

## Goals

1. A user's language choice persists across all pages and navigation paths.
2. A language switcher is available on every page via the shared layout nav.
3. Existing behavior preserved: `?lang=` param remains authoritative, default is `zh`,
   Google OAuth round-trip continues to restore the correct language.

## Non-Goals

- No new locales beyond `zh` / `en`.
- No restructuring of existing inline bilingual strings (`lang === 'zh' ? ... : ...`).
- No client-side language detection (Accept-Language header / navigator).

## Design

### 1. Shared helper — `src/lib/i18n.ts`

New module exporting:

```ts
resolveLang(Astro): Lang  // Lang = 'zh' | 'en' (reuse type from src/lib/tarot.ts)
```

Resolution order:

1. `?lang` query param, if present and exactly `'en'` or `'zh'`. When a valid param is
   present, also persist it into the `lang` cookie so the choice survives navigation.
2. Otherwise the `lang` cookie, if its value is `'en'` or `'zh'`.
3. Otherwise `'zh'`.

Cookie attributes: `path: '/'`, `httpOnly: true`, `sameSite: 'lax'`,
`maxAge` = 1 year (31536000). The cookie is set on every request carrying a valid
`?lang` param (idempotent refresh).

Also export a small helper used by the nav switcher:

```ts
langSwitchHref(Astro, target: Lang): string
```

Returns the current path + search with `lang` set to `target` (all other query params
preserved), so switching on any page stays on that page.

### 2. Pages adopt the helper

Every SSR page replaces its inline language line with `resolveLang(Astro)`:

- `src/pages/index.astro`
- `src/pages/login.astro`
- `src/pages/signup.astro`
- `src/pages/pricing.astro`
- `src/pages/account.astro`
- `src/pages/history/index.astro`
- `src/pages/privacy.astro`
- `src/pages/library/index.astro`
- `src/pages/library/[slug].astro`

Each page passes `lang` to `Layout` as a prop.

### 3. Shared switcher in `src/layouts/Layout.astro`

- Layout gains a required `lang: Lang` prop.
- `<html lang="zh">` becomes `<html lang={lang}>`.
- The `.top-nav` gains `中文` / `English` links using `langSwitchHref`, with the active
  language bolded (matching the existing `font-weight: bold` convention). Existing
  `.language-switcher` CSS styling is reused for these links.
- Nav links (`/account` | `/login`, `/pricing`, `/privacy`) are left without `?lang=` —
  the cookie fallback carries the language.

### 4. Per-page duplicate switchers removed

- `index.astro`: remove the `.language-switcher` block's 中文/English links (kept: the
  Card Library link, moved into the nav or kept as-is without lang param since the cookie
  covers it — keep it in place, drop the manual `?lang=`).
- `library/index.astro` and `library/[slug].astro`: remove their 中文/English nav links;
  change the hardcoded `/?lang=zh` home link to a plain `/`.
- `privacy.astro`: remove the inline `policy-lang` "Switch to English / 切换到中文" link.

### 5. Compatibility notes

- Google OAuth flow unchanged: `start.ts` still snapshots `oauth_lang`;
  `callback.ts` still reads it for error/success redirects. Post-redirect pages resolve
  language via param → cookie as usual.
- POST forms on `index.astro` submit to the current URL; even without the param, the
  cookie fallback renders the correct language on re-render/error paths.
- `pricing.astro` / Stripe redirects: any redirect URL without `?lang=` is now covered by
  the cookie.

### 6. Privacy page copy update

The cookies section (s5) is updated in both languages to mention the language-preference
cookie: an essential cookie storing the display-language choice (~1 year).

## Testing

- Unit test for `resolveLang` precedence (param > cookie > default) and cookie persistence,
  following existing vitest patterns in `src/lib/__tests__/`.
- Manual smoke test: switch to English on homepage → navigate via nav to signup, login,
  pricing, privacy, library → all render in English; switch back on any page → persists
  everywhere; direct URL visit without params stays in the last chosen language.

## Assumptions

- No analytics/SEO requirements around hreflang or per-language URLs (query-param scheme
  is retained as the override mechanism, not the persistence mechanism).
- `httpOnly` is acceptable for the lang cookie since only the server reads it.
