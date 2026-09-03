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
  mode: 'tarot',
  spread: '3card',
  question: 'What should I be aware of in the coming period?',
  cards: [
    { en: 'The Fool', reversed: false },
    { en: 'The Moon', reversed: true },
    { en: 'The Star', reversed: false },
  ],
  ts: Date.now(),
};
const CELTIC: PendingDraw = {
  ...DRAW,
  spread: 'celtic_cross',
  cards: Array.from({ length: 10 }, (_, i) => ({ en: `Card ${i}`, reversed: i % 2 === 0 })),
};
const BIBLE: PendingDraw = {
  v: 1,
  mode: 'bible',
  spread: '3card',
  question: 'Where is God leading me?',
  verses: ['John 3:16', 'Psalm 23:1', 'Romans 8:28'],
  ts: Date.now(),
};

describe('pendingDraw token roundtrip', () => {
  it('verifies tarot tokens it created', async () => {
    const token = await createPendingDrawToken(DRAW, SECRET);
    const verified = await verifyPendingDrawToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.mode).toBe('tarot');
    expect(verified!.spread).toBe('3card');
    expect(verified!.question).toBe(DRAW.question);
    expect(verified!.cards).toEqual(DRAW.cards);
  });

  it('verifies celtic cross tokens with 10 cards', async () => {
    const token = await createPendingDrawToken(CELTIC, SECRET);
    const verified = await verifyPendingDrawToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.spread).toBe('celtic_cross');
    expect(verified!.cards).toHaveLength(10);
  });

  it('verifies bible tokens with verse refs', async () => {
    const token = await createPendingDrawToken(BIBLE, SECRET);
    const verified = await verifyPendingDrawToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.mode).toBe('bible');
    expect(verified!.verses).toEqual(BIBLE.verses);
    expect(verified!.cards).toBeUndefined();
  });

  it('rejects a tampered payload', async () => {
    const token = await createPendingDrawToken(DRAW, SECRET);
    const [encoded, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...DRAW, cards: [{ en: 'The World', reversed: false }, ...(DRAW.cards ?? []).slice(1)] })
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
    expect(await make({ ...DRAW, mode: 'bible' })).toBeNull(); // tarot spread + bible payload
    expect(await make({ ...BIBLE, mode: 'tarot' })).toBeNull(); // bible refs + tarot mode
    expect(await make({ ...DRAW, spread: 'single' })).toBeNull();
    expect(await make({ ...DRAW, cards: [] })).toBeNull();
    expect(await make({ ...DRAW, cards: [{ en: 'The Fool' }] })).toBeNull();
    expect( // 11 cards exceed the Celtic Cross cap
      await make({
        ...CELTIC,
        cards: Array.from({ length: 11 }, (_, i) => ({ en: `Card ${i}`, reversed: false })),
      })
    ).toBeNull();
    expect(await make({ ...BIBLE, verses: [] })).toBeNull();
    expect(await make({ ...BIBLE, verses: ['John 3:16', ''] })).toBeNull();
    expect(await make({ ...BIBLE, ts: 'not-a-number' })).toBeNull();
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
