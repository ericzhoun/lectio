import { describe, it, expect } from 'vitest';
import { resolveLang, langSwitchHref } from '../i18n';

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
