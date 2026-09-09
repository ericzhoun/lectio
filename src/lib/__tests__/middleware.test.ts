import { describe, expect, it, vi } from 'vitest';
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
import { onRequest } from '../../middleware';

// Minimal stand-in for Astro's APIContext; middleware only reads
// url/cookies/request/isPrerendered and writes locals, mirroring the
// partial-context idiom of the other tests.
function context(url: string, init?: RequestInit) {
  return {
    url: new URL(url),
    request: new Request(url, init),
    isPrerendered: false,
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

// Astro's own security.checkOrigin guard runs ahead of this middleware in a
// real request and is turned off globally in astro.config.mjs (it has no
// per-route exemption); this reimplements it here so /unsubscribe can accept
// a token-authenticated POST with no Origin header while every other
// on-demand POST route keeps the exact behavior Astro's own guard gave it.
// This exercises onRequest end to end (method + headers in, response out),
// which is the closest this project's Vitest setup gets to a real request
// cycle without standing up wrangler dev - there is no HTTP server harness
// wired into `npm test`, so the empirical 403 that shipped uncaught (see
// task-6-report.md, fix round 1) was verified against a live `wrangler dev`
// instead, not by an automated test.
describe('middleware cross-origin guard', () => {
  it('rejects a cross-site form POST to an ordinary route', async () => {
    const response = await onRequest(
      context('https://lectio.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      () => new Response('should not reach here')
    );
    expect(response.status).toBe(403);
  });

  it('allows a same-origin form POST to an ordinary route', async () => {
    const response = await onRequest(
      context('https://lectio.test/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://lectio.test',
        },
      }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });

  it('allows a cross-site, no-Origin form POST to /unsubscribe (mail client one-click)', async () => {
    const response = await onRequest(
      context('https://lectio.test/unsubscribe?e=reader%40example.test&t=whatever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });

  it('leaves safe methods (GET) alone regardless of Origin', async () => {
    const response = await onRequest(
      context('https://lectio.test/api/auth/login', { method: 'GET' }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });
});
