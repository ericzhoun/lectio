import { describe, it, expect } from 'vitest';
import { resolveLang, langSwitchHref, langHref } from '../i18n';

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
  it('defaults to en with no param and no cookie', () => {
    const { astro } = makeAstro({});
    expect(resolveLang(astro)).toBe('en');
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
    expect(resolveLang(makeAstro({ lang: 'fr' }).astro)).toBe('en');
    expect(resolveLang(makeAstro({}, { lang: 'garbage' }).astro)).toBe('en');
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

describe('langHref', () => {
  it('leaves English links bare (the canonical form)', () => {
    expect(langHref('/pricing', 'en')).toBe('/pricing');
    expect(langHref('/?new=1', 'en')).toBe('/?new=1');
  });

  it('keeps ?lang=zh on Chinese links', () => {
    expect(langHref('/pricing', 'zh')).toBe('/pricing?lang=zh');
    expect(langHref('/library?card=moon', 'zh')).toBe('/library?lang=zh&card=moon');
  });

  it('replaces an existing lang param instead of duplicating it', () => {
    expect(langHref('/library?lang=en', 'en')).toBe('/library');
    expect(langHref('/library?lang=en', 'zh')).toBe('/library?lang=zh');
  });

  it('keeps the fragment after the query', () => {
    expect(langHref('/library?card=moon#x', 'zh')).toBe('/library?lang=zh&card=moon#x');
  });
});

describe('langSwitchHref', () => {
  it('links to the Chinese page with ?lang=zh', () => {
    const { astro } = makeAstro({});
    astro.url = new URL('https://example.com/pricing');
    expect(langSwitchHref(astro, 'zh', 'en')).toBe('/pricing?lang=zh');
  });

  it('links English back to the bare URL from an English page', () => {
    const { astro } = makeAstro({});
    astro.url = new URL('https://example.com/pricing');
    expect(langSwitchHref(astro, 'en', 'en')).toBe('/pricing');
  });

  it('keeps one ?lang=en link on a Chinese page so the switch still flips the cookie', () => {
    const { astro } = makeAstro({});
    astro.url = new URL('https://example.com/library?suit=cups&lang=zh');
    expect(langSwitchHref(astro, 'en', 'zh')).toBe('/library?suit=cups&lang=en');
  });

  it('preserves other query params when switching to Chinese', () => {
    const { astro } = makeAstro({});
    astro.url = new URL('https://example.com/library?suit=cups');
    expect(langSwitchHref(astro, 'zh', 'en')).toBe('/library?suit=cups&lang=zh');
  });
});
