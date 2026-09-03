import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '../session';

const SECRET = 'test-secret';

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionToken('user-123', SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe('user-123');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken('user-123', SECRET);
    expect(await verifySessionToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken('user-123', SECRET);
    const tampered = token.replace('user-123', 'user-456');
    expect(await verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken('user-123', SECRET, -1);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('throws when the session secret is empty', async () => {
    await expect(createSessionToken('user-123', '')).rejects.toThrow('SESSION_SECRET is required');
    await expect(verifySessionToken('a.b.c', '')).rejects.toThrow('SESSION_SECRET is required');
  });
});
