import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../crypto';

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});
