import { describe, expect, it } from 'vitest';
import { signMailToken, verifyMailToken } from '../mailToken';

const SECRET = 'test-mail-secret';

describe('mail tokens', () => {
  it('verifies a token it just signed', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(true);
  });

  it('is url safe so it survives a query string', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('rejects a tampered token', async () => {
    const token = await signMailToken('reader@example.test', SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await verifyMailToken('reader@example.test', tampered, SECRET)).toBe(false);
  });

  it('rejects a token minted for a different address', async () => {
    const token = await signMailToken('someone@example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signMailToken('reader@example.test', 'other-secret');
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(false);
  });

  it('treats the address case-insensitively, as the signup route lowercases it', async () => {
    const token = await signMailToken('Reader@Example.test', SECRET);
    expect(await verifyMailToken('reader@example.test', token, SECRET)).toBe(true);
  });

  it('rejects an empty or malformed token without throwing', async () => {
    expect(await verifyMailToken('reader@example.test', '', SECRET)).toBe(false);
    expect(await verifyMailToken('reader@example.test', 'not base64!!', SECRET)).toBe(false);
  });
});
