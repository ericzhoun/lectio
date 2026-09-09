import { describe, expect, it, vi } from 'vitest';
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
import { onRequest } from '../../middleware';

// Minimal stand-in for Astro's APIContext; middleware only reads url/cookies
// and writes locals, mirroring the partial-context idiom of the other tests.
function context(url: string) {
  return {
    url: new URL(url),
    cookies: { get: () => undefined, set: vi.fn() },
    locals: {},
  } as any;
}

describe('middleware cache-control guard', () => {
  it('marks personalized HTML as private, no-store', async () => {
    const response = await onRequest(context('https://lectio.test/today/silencio'), () =>
      new Response('<html lang="zh"></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('marks route redirects (e.g. /today -> /today/<step>) as private, no-store', async () => {
    const next = vi.fn(async () => Response.redirect('https://lectio.test/today/silencio', 302));
    const response = await onRequest(context('https://lectio.test/today'), next);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://lectio.test/today/silencio');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('marks its own trailing-slash 308 redirect as private, no-store', async () => {
    const response = await onRequest(context('https://lectio.test/library/'), () => new Response(null));
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('/library');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('leaves responses that already set Cache-Control untouched', async () => {
    const response = await onRequest(context('https://lectio.test/audio/en/silencio.mp3'), () =>
      new Response('audio', {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
      }));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('leaves non-HTML, non-redirect responses without Cache-Control alone', async () => {
    const response = await onRequest(context('https://lectio.test/api/assistant/quota'), () =>
      new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
    expect(response.headers.get('Cache-Control')).toBeNull();
  });
});
