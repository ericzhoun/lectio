import { describe, it, expect, vi, afterEach } from 'vitest';
import { signCardToken, verifyCardToken, CARD_TTL_MS } from '../assistantCards';

const SECRET = 'test-secret';

afterEach(() => vi.useRealTimers());

describe('assistant confirm cards', () => {
  it('round-trips a card for the visitor it was issued to', async () => {
    const token = await signCardToken(
      { tool: 'subscribe_daily_email', args: { email: 'a@b.com', lang: 'en', tz: 'UTC' }, visitorKey: 'u:1' },
      SECRET
    );
    const payload = await verifyCardToken(token, 'u:1', SECRET);
    expect(payload?.tool).toBe('subscribe_daily_email');
    expect(payload?.args).toEqual({ email: 'a@b.com', lang: 'en', tz: 'UTC' });
  });

  it('rejects a card issued to a different visitor', async () => {
    const token = await signCardToken({ tool: 't', args: {}, visitorKey: 'u:1' }, SECRET);
    expect(await verifyCardToken(token, 'u:2', SECRET)).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await signCardToken({ tool: 't', args: { email: 'a@b.com' }, visitorKey: 'u:1' }, SECRET);
    const [body, sig] = token.split('.');
    const forged = `${btoa('{"v":1,"tool":"t","args":{"email":"evil@b.com"},"visitorKey":"u:1","ts":0}')}.${sig}`;
    expect(await verifyCardToken(forged, 'u:1', SECRET)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const token = await signCardToken({ tool: 't', args: {}, visitorKey: 'u:1' }, SECRET);
    vi.setSystemTime(new Date(Date.now() + CARD_TTL_MS + 1000));
    expect(await verifyCardToken(token, 'u:1', SECRET)).toBeNull();
  });

  it('rejects a missing token', async () => {
    expect(await verifyCardToken(undefined, 'u:1', SECRET)).toBeNull();
  });
});
