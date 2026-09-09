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

  // The origin check runs before middleware.ts's own trailing-slash redirect,
  // so a request that arrives with a trailing slash (a link-rewriter, a
  // proxy, or a future edit to unsubscribeUrl) must not fall through to a
  // 403 that a redirect never gets a chance to fix. Same for case: mail
  // clients and intermediaries are not guaranteed to preserve exact case.
  it('exempts /unsubscribe with a trailing slash', async () => {
    const response = await onRequest(
      context('https://lectio.test/unsubscribe/?e=reader%40example.test&t=whatever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });

  it('exempts /unsubscribe regardless of case', async () => {
    const response = await onRequest(
      context('https://lectio.test/Unsubscribe?e=reader%40example.test&t=whatever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });

  // The exemption must stay an exact match, not a prefix match - a
  // similarly-named route must still be guarded so this hardening cannot
  // silently widen into "anything starting with /unsubscribe".
  it('still guards a near-miss path like /unsubscribe-all', async () => {
    const response = await onRequest(
      context('https://lectio.test/unsubscribe-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      () => new Response('should not reach here')
    );
    expect(response.status).toBe(403);
  });

  it('still guards a near-miss path like /unsubscribeX', async () => {
    const response = await onRequest(
      context('https://lectio.test/unsubscribeX', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
      () => new Response('should not reach here')
    );
    expect(response.status).toBe(403);
  });

  // Resend's webhook is a server-to-server POST: no Origin header, JSON
  // content type. The JSON content type alone already keeps it out of the
  // form-like branch (see resend-webhook.test.ts), but a request with NO
  // content-type header at all falls through to the bare `!isSameOrigin`
  // check, which a machine-to-machine call with no Origin header would fail.
  // That is exactly the latent single point of failure this exemption closes
  // - without it, bounce/complaint suppression would 403 before the route's
  // own Svix signature check ever ran, with no visible error anywhere.
  it('exempts /api/resend-webhook from a cross-site POST with no content-type or Origin', async () => {
    const response = await onRequest(
      context('https://lectio.test/api/resend-webhook', { method: 'POST' }),
      () => new Response('ok')
    );
    expect(response.status).not.toBe(403);
  });

  // Exact match only, same discipline as /unsubscribe - a similarly-named
  // path must stay guarded so the exemption cannot silently widen.
  it('still guards a near-miss path like /api/resend-webhook-extra', async () => {
    const response = await onRequest(
      context('https://lectio.test/api/resend-webhook-extra', { method: 'POST' }),
      () => new Response('should not reach here')
    );
    expect(response.status).toBe(403);
  });
});
