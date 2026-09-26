// Canonical URL and hreflang policy for the whole site.
//
// Language variants share one path: the bare URL is the English page and
// ?lang=zh is the Chinese page. Each variant must self-canonicalize — pointing
// one language at the other makes Google treat those pages as designated
// alternates ("Alternate page with proper canonical tag" in Search Console)
// and leave them out of the index. Google's guidance for multilingual sites:
// hreflang between language versions, never canonical.
//
// The middleware additionally 308s trailing-slash forms onto the canonical
// no-slash path; normalizePath keeps the tags consistent even if a page
// renders before that redirect ever fires.

export const SITE_URL = 'https://enjoyhim.org';

// Collapse trailing slashes onto the no-slash form so /pricing/ and /pricing
// share one canonical URL.
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

// langParam must be the URL's own ?lang= value — not the cookie-resolved
// language — so a crawler always gets a deterministic canonical for the URL
// it fetched (Googlebot sends no cookies). Anything other than ?lang=zh
// (bare, ?lang=en, stray params) canonicalizes to the bare path.
export function canonicalHref(pathname: string, langParam: string | null): string {
  const path = normalizePath(pathname);
  const suffix = langParam === 'zh' ? '?lang=zh' : '';
  return `${SITE_URL}${path}${suffix}`;
}

export interface HreflangAlternate {
  hreflang: 'en' | 'zh' | 'x-default';
  href: string;
}

// One invariant cluster per path: every variant lists all variants (required
// for hreflang) and each variant is its own canonical.
export function hreflangAlternates(pathname: string): HreflangAlternate[] {
  const path = normalizePath(pathname);
  return [
    { hreflang: 'en', href: `${SITE_URL}${path}` },
    { hreflang: 'zh', href: `${SITE_URL}${path}?lang=zh` },
    { hreflang: 'x-default', href: `${SITE_URL}${path}` },
  ];
}
