// Language resolution and persistence.
// Priority: explicit ?lang= param (persisted to cookie) > lang cookie > 'en'.
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
  return 'en';
}

// href for the nav language switcher: stay on the current page, swap lang,
// keep all other query params.
export function langSwitchHref(astro: LangRequestContext, target: Lang): string {
  const params = new URLSearchParams(astro.url.searchParams);
  params.set('lang', target);
  return `${astro.url.pathname}?${params.toString()}`;
}
