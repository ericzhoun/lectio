import { describe, expect, it } from 'vitest';
import { safeAuthReturn } from '../authReturn';

describe('safeAuthReturn', () => {
  it('preserves the page, language, filters and anchor', () => {
    expect(safeAuthReturn('/library?lang=en&card=moon#meaning')).toBe('/library?lang=en&card=moon#meaning');
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/login', '/signup?lang=en', '/api/auth/google/start', '', null])('rejects unsafe or looping destination %s', (value) => {
    expect(safeAuthReturn(value, '/?lang=en')).toBe('/?lang=en');
  });
});
