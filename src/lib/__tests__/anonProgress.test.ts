import { describe, it, expect } from 'vitest';
import {
  ANON_PROGRESS_COOKIE, recordAnonProgress, takeAnonProgress,
} from '../anonProgress';

const SECRET = 'test-secret';
const DAY = '2026-09-06';

// Minimal CookieStore stand-in over a plain map.
function fakeCookies(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
  };
}

describe('recordAnonProgress', () => {
  it('writes a signed cookie', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, DAY, 'lectio', SECRET);
    const token = cookies.store.get(ANON_PROGRESS_COOKIE);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');
  });

  it('ignores a step that is not a step', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, DAY, 'brunch' as never, SECRET);
    expect(cookies.store.has(ANON_PROGRESS_COOKIE)).toBe(false);
  });
});

describe('takeAnonProgress', () => {
  it('round-trips the recorded step and clears the cookie', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, DAY, 'lectio', SECRET);
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBe('lectio');
    expect(cookies.store.has(ANON_PROGRESS_COOKIE)).toBe(false);
  });

  it('yields nothing when the cookie was recorded for another day', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, '2026-09-05', 'lectio', SECRET);
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBeNull();
    expect(cookies.store.has(ANON_PROGRESS_COOKIE)).toBe(false);
  });

  it('rejects a tampered token', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, DAY, 'lectio', SECRET);
    const token = cookies.store.get(ANON_PROGRESS_COOKIE)!;
    // The payload is base64url-encoded JSON, so tamper at the token level:
    // an extra payload byte and a swapped signature both fail verification.
    const [payload] = token.split('.');
    cookies.store.set(ANON_PROGRESS_COOKIE, `${payload}A.AAAA`);
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBeNull();
    cookies.store.set(ANON_PROGRESS_COOKIE, `${payload}.${'A'.repeat(43)}`);
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const cookies = fakeCookies();
    await recordAnonProgress(cookies, DAY, 'lectio', 'other-secret');
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBeNull();
  });

  it('yields nothing without a cookie', async () => {
    const cookies = fakeCookies();
    expect(await takeAnonProgress(cookies, DAY, SECRET)).toBeNull();
  });
});
