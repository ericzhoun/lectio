import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, RESEND_WEBHOOK_SECRET: 'whsec_c2VjcmV0LWZvci10ZXN0aW5n' },
}));
vi.mock('../subscribers', () => ({
  ensureSubscriberTable: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
}));
import { setStatus } from '../subscribers';
import { POST } from '../../pages/api/resend-webhook';
import { isForbiddenCrossOriginRequest } from '../originCheck';

const SECRET_B64 = 'c2VjcmV0LWZvci10ZXN0aW5n';

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(SECRET_B64), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

async function post(event: unknown, { valid = true } = {}) {
  const body = JSON.stringify(event);
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = valid ? await sign(id, timestamp, body) : 'v1,bm90LWEtc2lnbmF0dXJl';
  return POST({
    request: new Request('https://enjoyhim.org/api/resend-webhook', {
      method: 'POST',
      body,
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
    }),
  } as any);
}

beforeEach(() => vi.clearAllMocks());

describe('resend webhook', () => {
  it('suppresses an address that hard bounced', async () => {
    const response = await post({
      type: 'email.bounced',
      data: { to: ['reader@example.test'], bounce: { type: 'Permanent' } },
    });
    expect(response.status).toBe(200);
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'bounced');
  });

  it('suppresses an address that complained', async () => {
    await post({ type: 'email.complained', data: { to: ['reader@example.test'] } });
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'bounced');
  });

  it('leaves a soft bounce alone, since the next morning may well work', async () => {
    // Resend's own docs label the soft-bounce value "Temporary" (the brief said
    // "Transient"); either way this must not match the strict 'Permanent' check.
    await post({
      type: 'email.bounced',
      data: { to: ['reader@example.test'], bounce: { type: 'Transient' } },
    });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('ignores events it does not act on', async () => {
    const response = await post({ type: 'email.delivered', data: { to: ['reader@example.test'] } });
    expect(response.status).toBe(200);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const response = await post(
      { type: 'email.complained', data: { to: ['reader@example.test'] } },
      { valid: false }
    );
    expect(response.status).toBe(401);
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe('resend webhook, malformed inputs', () => {
  it('fails closed with a clear 500 when the configured secret is not valid base64', async () => {
    vi.resetModules();
    vi.doMock('cloudflare:workers', () => ({
      env: { DB: {}, RESEND_WEBHOOK_SECRET: 'whsec_not-valid-base64!!!' },
    }));
    vi.doMock('../subscribers', () => ({
      ensureSubscriberTable: vi.fn().mockResolvedValue(undefined),
      setStatus: vi.fn().mockResolvedValue(undefined),
    }));
    const { POST: brokenSecretPost } = await import('../../pages/api/resend-webhook');
    const response = await brokenSecretPost({
      request: new Request('https://enjoyhim.org/api/resend-webhook', {
        method: 'POST',
        body: '{}',
        headers: { 'svix-id': 'msg_1', 'svix-timestamp': '0', 'svix-signature': 'v1,x' },
      }),
    } as any);
    expect(response.status).toBe(500);
    vi.resetModules();
  });

  it('treats a malformed (non-base64) signature entry as non-matching, not a crash', async () => {
    const response = await POST({
      request: new Request('https://enjoyhim.org/api/resend-webhook', {
        method: 'POST',
        body: '{}',
        headers: {
          'svix-id': 'msg_1',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,not-valid-base64!!!',
        },
      }),
    } as any);
    expect(response.status).toBe(401);
    expect(setStatus).not.toHaveBeenCalled();
  });
});

// Pins the CSRF guard's behavior for this route: Resend's webhook is a
// cross-origin JSON POST with no Origin header. The guard only blocks
// cross-origin POSTs whose content type is form-like (see originCheck.ts);
// application/json is not in that list, so this request is never forbidden
// and the route needs no entry in the exemption list.
describe('resend webhook and the site-wide CSRF guard', () => {
  it('does not forbid a cross-origin JSON POST to the webhook path', () => {
    const request = new Request('https://enjoyhim.org/api/resend-webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const url = new URL(request.url);
    expect(isForbiddenCrossOriginRequest(request, url, false)).toBe(false);
  });
});
