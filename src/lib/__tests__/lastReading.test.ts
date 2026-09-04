import { describe, it, expect } from 'vitest';
import {
  createLastReadingToken,
  verifyLastReadingToken,
  LAST_READING_TTL_MS,
  type LastReading,
} from '../lastReading';
import { PENDING_QUESTION_MAX_CHARS } from '../pendingDraw';

const SECRET = '***';
const READING: LastReading = {
  v: 1,
  id: 'a1b2c3',
  spread: 'celtic_cross',
  question: 'Where is God leading me?',
  verses: Array.from({ length: 10 }, (_, i) => `Psalm ${i + 1}:1`),
  ts: Date.now(),
};

describe('lastReading token roundtrip', () => {
  it('verifies tokens it created', async () => {
    const verified = await verifyLastReadingToken(
      await createLastReadingToken(READING, SECRET),
      SECRET
    );
    expect(verified).not.toBeNull();
    expect(verified!.id).toBe('a1b2c3');
    expect(verified!.spread).toBe('celtic_cross');
    expect(verified!.verses).toEqual(READING.verses);
  });

  it('accepts the single-verse layout', async () => {
    const single = { ...READING, spread: 'single', verses: ['John 3:16'] };
    const verified = await verifyLastReadingToken(
      await createLastReadingToken(single, SECRET),
      SECRET
    );
    expect(verified!.spread).toBe('single');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createLastReadingToken(READING, SECRET);
    expect(await verifyLastReadingToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await createLastReadingToken(READING, SECRET);
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ ...READING, verses: ['John 3:16'] }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyLastReadingToken(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects an unknown layout', async () => {
    const token = await createLastReadingToken({ ...READING, spread: 'nope' }, SECRET);
    expect(await verifyLastReadingToken(token, SECRET)).toBeNull();
  });

  it('rejects more verses than the largest layout', async () => {
    const token = await createLastReadingToken(
      { ...READING, verses: Array.from({ length: 11 }, (_, i) => `Psalm ${i + 1}:1`) },
      SECRET
    );
    expect(await verifyLastReadingToken(token, SECRET)).toBeNull();
  });

  it('rejects an empty verse list', async () => {
    const token = await createLastReadingToken({ ...READING, verses: [] }, SECRET);
    expect(await verifyLastReadingToken(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createLastReadingToken(
      { ...READING, ts: Date.now() - LAST_READING_TTL_MS - 1000 },
      SECRET
    );
    expect(await verifyLastReadingToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed and missing tokens', async () => {
    expect(await verifyLastReadingToken(undefined, SECRET)).toBeNull();
    expect(await verifyLastReadingToken('', SECRET)).toBeNull();
    expect(await verifyLastReadingToken('not-a-token', SECRET)).toBeNull();
  });

  it('truncates an over-long question rather than rejecting it', async () => {
    const token = await createLastReadingToken(
      { ...READING, question: 'x'.repeat(PENDING_QUESTION_MAX_CHARS + 50) },
      SECRET
    );
    const verified = await verifyLastReadingToken(token, SECRET);
    expect(verified!.question.length).toBe(PENDING_QUESTION_MAX_CHARS);
  });
});
