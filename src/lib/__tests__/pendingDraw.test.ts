import { describe, it, expect } from 'vitest';
import {
  createPendingDrawToken,
  verifyPendingDrawToken,
  truncateQuestion,
  PENDING_QUESTION_MAX_CHARS,
  type PendingDraw,
} from '../pendingDraw';

const SECRET = '***';
const DRAW: PendingDraw = {
  v: 1,
  spread: '3card',
  question: 'Where is God leading me?',
  verses: ['John 3:16', 'Psalm 23:1', 'Romans 8:28'],
  ts: Date.now(),
};
const DEEP: PendingDraw = {
  ...DRAW,
  spread: 'celtic_cross',
  verses: Array.from({ length: 10 }, (_, i) => `Psalm ${i + 1}:1`),
};

describe('pendingDraw token roundtrip', () => {
  it('verifies tokens it created', async () => {
    const token = await createPendingDrawToken(DRAW, SECRET);
    const verified = await verifyPendingDrawToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.spread).toBe('3card');
    expect(verified!.question).toBe(DRAW.question);
    expect(verified!.verses).toEqual(DRAW.verses);
  });

  it('verifies deep lectio tokens with 10 verses', async () => {
    const token = await createPendingDrawToken(DEEP, SECRET);
    const verified = await verifyPendingDrawToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.spread).toBe('celtic_cross');
    expect(verified!.verses).toHaveLength(10);
  });

  it('rejects a tampered payload', async () => {
    const token = await createPendingDrawToken(DRAW, SECRET);
    const [encoded, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...DRAW, verses: ['Revelation 21:4', ...DRAW.verses.slice(1)] })
    ).toString('base64url');
    expect(await verifyPendingDrawToken(`${forged}.${sig}`, SECRET)).toBeNull();
    // A modified signature over the original payload is rejected too.
    expect(await verifyPendingDrawToken(`${encoded}.${sig.slice(0, -2)}xx`, SECRET)).toBeNull();
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await createPendingDrawToken(DRAW, 'other-secret');
    expect(await verifyPendingDrawToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyPendingDrawToken('', SECRET)).toBeNull();
    expect(await verifyPendingDrawToken('garbage', SECRET)).toBeNull();
    expect(await verifyPendingDrawToken('a.b.c', SECRET)).toBeNull();
    expect(await verifyPendingDrawToken(null, SECRET)).toBeNull();
    expect(await verifyPendingDrawToken(undefined, SECRET)).toBeNull();
  });

  it('rejects structurally invalid payloads even with a valid signature', async () => {
    const make = (payload: unknown) =>
      createPendingDrawToken(payload as PendingDraw, SECRET).then((t) => verifyPendingDrawToken(t, SECRET));

    expect(await make({ ...DRAW, v: 2 })).toBeNull();
    expect(await make({ ...DRAW, spread: 'single' })).toBeNull();
    expect(await make({ ...DRAW, verses: [] })).toBeNull();
    expect(await make({ ...DRAW, verses: ['John 3:16', ''] })).toBeNull();
    expect(await make({ ...DRAW, verses: [123, 'John 3:16'] })).toBeNull();
    expect( // 11 verses exceed the Deep Lectio cap
      await make({
        ...DEEP,
        verses: Array.from({ length: 11 }, (_, i) => `Psalm ${i + 1}:1`),
      })
    ).toBeNull();
    expect(await make({ ...DRAW, ts: 'not-a-number' })).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const expired: PendingDraw = { ...DRAW, ts: Date.now() - 8 * 24 * 60 * 60 * 1000 };
    const token = await createPendingDrawToken(expired, SECRET);
    expect(await verifyPendingDrawToken(token, SECRET)).toBeNull();
  });
});

describe('truncateQuestion', () => {
  it('trims and caps the question length', () => {
    expect(truncateQuestion('  hi  ')).toBe('hi');
    expect(truncateQuestion('x'.repeat(PENDING_QUESTION_MAX_CHARS + 50))).toHaveLength(PENDING_QUESTION_MAX_CHARS);
  });
});
