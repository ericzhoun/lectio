// Language resolution and persistence.
// Priority: explicit ?lang= param (persisted to cookie) > lang cookie > 'en'.
import type { Lang } from './reading';

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
  return 'en';
}

// Link policy after the Oct 2026 indexing fix: only Chinese carries an
// explicit ?lang=zh; English links point at the bare (canonical) path. Every
// ?lang=en twin used to serve a second copy of an English page, which Google
// filed as "Alternate page with proper canonical tag" (146 URLs) instead of
// indexing. langHref() takes any relative href and applies that policy.
export function langHref(href: string, lang: Lang): string {
  const hashIndex = href.indexOf('#');
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const core = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = core.indexOf('?');
  const path = queryIndex === -1 ? core : core.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? '' : core.slice(queryIndex + 1));
  params.delete('lang');
  const out = new URLSearchParams();
  if (lang === 'zh') out.set('lang', 'zh');
  for (const [key, value] of params) out.append(key, value);
  const query = out.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}

// href for the nav language switcher: stay on the current page, swap lang,
// keep all other query params. Three cases:
//   - target 'zh': always ?lang=zh (the ordinary render sets the cookie).
//   - target 'en' from an English page: bare path — English is the default,
//     and a bare link keeps the switcher from re-introducing ?lang=en twins.
//   - target 'en' from a Chinese page: keep just that one ?lang=en link, so a
//     reader carrying the zh cookie still lands in English; the middleware's
//     ?lang=en 301 sets the cookie and consolidates the URL for crawlers.
export function langSwitchHref(astro: LangRequestContext, target: Lang, currentLang: Lang): string {
  const params = new URLSearchParams(astro.url.searchParams);
  params.delete('lang');
  if (target === 'zh' || currentLang === 'zh') params.set('lang', target);
  const query = params.toString();
  return query ? `${astro.url.pathname}?${query}` : astro.url.pathname;
}
