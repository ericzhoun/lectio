import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ env: { DB: {}, MAIL_TOKEN_SECRET: 'test-mail-secret' } }));
vi.mock('../subscribers', () => ({
  ensureSubscriberTable: vi.fn().mockResolvedValue(undefined),
  setStatus: vi.fn().mockResolvedValue(undefined),
}));
import { setStatus } from '../subscribers';
import { signMailToken } from '../mailToken';
import { unsubscribeFromRequest } from '../unsubscribe';

const SECRET = 'test-mail-secret';

beforeEach(() => vi.clearAllMocks());

describe('unsubscribe', () => {
  it('removes a reader whose token checks out', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    const url = new URL(`https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=${token}`);
    expect(await unsubscribeFromRequest(url)).toBe(true);
    expect(setStatus).toHaveBeenCalledWith({}, 'reader@example.test', 'unsubscribed');
  });

  it('changes nothing when the token is wrong', async () => {
    const url = new URL('https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=forged');
    expect(await unsubscribeFromRequest(url)).toBe(false);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('changes nothing when the address is missing', async () => {
    const url = new URL('https://enjoyhim.org/unsubscribe?t=whatever');
    expect(await unsubscribeFromRequest(url)).toBe(false);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('accepts a plus-addressed reader', async () => {
    const token = await signMailToken('reader+daily@example.test', SECRET);
    const url = new URL(
      `https://enjoyhim.org/unsubscribe?e=${encodeURIComponent('reader+daily@example.test')}&t=${token}`
    );
    expect(await unsubscribeFromRequest(url)).toBe(true);
  });
});
