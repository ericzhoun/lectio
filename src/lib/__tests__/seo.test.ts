import { describe, it, expect } from 'vitest';
import { canonicalHref, hreflangAlternates, normalizePath, SITE_URL } from '../seo';

describe('normalizePath', () => {
  it('keeps the root as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('strips a trailing slash', () => {
    expect(normalizePath('/pricing/')).toBe('/pricing');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizePath('/library//')).toBe('/library');
  });

  it('leaves interior slashes alone', () => {
    expect(normalizePath('/library/john-3-16')).toBe('/library/john-3-16');
  });
});

describe('canonicalHref', () => {
  it('self-canonicalizes the zh variant', () => {
    expect(canonicalHref('/pricing', 'zh')).toBe(`${SITE_URL}/pricing?lang=zh`);
  });

  it('canonicalizes the bare URL to itself', () => {
    expect(canonicalHref('/pricing', null)).toBe(`${SITE_URL}/pricing`);
  });

  it('canonicalizes ?lang=en onto the bare URL', () => {
    expect(canonicalHref('/pricing', 'en')).toBe(`${SITE_URL}/pricing`);
  });

  it('drops unknown params and non-zh lang values', () => {
    expect(canonicalHref('/pricing', 'fr')).toBe(`${SITE_URL}/pricing`);
  });

  it('normalizes trailing slashes before building the URL', () => {
    expect(canonicalHref('/pricing/', 'zh')).toBe(`${SITE_URL}/pricing?lang=zh`);
    expect(canonicalHref('/', 'zh')).toBe(`${SITE_URL}/?lang=zh`);
  });
});

describe('hreflangAlternates', () => {
  it('lists en, zh and x-default for the path', () => {
    expect(hreflangAlternates('/pricing')).toEqual([
      { hreflang: 'en', href: `${SITE_URL}/pricing` },
      { hreflang: 'zh', href: `${SITE_URL}/pricing?lang=zh` },
      { hreflang: 'x-default', href: `${SITE_URL}/pricing` },
    ]);
  });

  it('is invariant across variants of the same path', () => {
    expect(hreflangAlternates('/library/john-3-16/')).toEqual(
      hreflangAlternates('/library/john-3-16')
    );
  });

  it('never points x-default at a ?lang URL', () => {
    for (const alt of hreflangAlternates('/approach')) {
      if (alt.hreflang === 'x-default') {
        expect(alt.href).not.toContain('?');
      }
    }
  });
});
