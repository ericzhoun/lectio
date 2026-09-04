// Signed cookie holding the reading currently on screen.
//
// A completed reading (verses + reflection) is produced inside a POST. Every
// later GET of the home page — a reload, a bookmark, and above all the nav
// language switch — has to be able to put the same reading back on screen.
// The cookie carries only the reading's identity (question, layout, verse
// refs); the verses are rebuilt from the refs in whatever language is now
// active, and the language-specific reflection is cached per language in D1
// (see getReadingRendering / saveReadingRendering in db.ts).
import { signJsonToken, readJsonToken } from './session';
import { truncateQuestion, PENDING_QUESTION_MAX_CHARS, PENDING_DRAW_MAX_ITEMS } from './pendingDraw';
import { SPREADS } from './reading';

export const LAST_READING_COOKIE = 'last_reading';
/** A finished reading stays retrievable for 7 days, like a pending draw. */
export const LAST_READING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface LastReading {
  v: 1;
  /** Cache key for the per-language reflections. */
  id: string;
  spread: string;
  question: string;
  /** Drawn verse identities (English refs are unique keys). */
  verses: string[];
  /** Issue time (ms since epoch), used for expiry. */
  ts: number;
}

export async function createLastReadingToken(
  reading: LastReading,
  secret: string
): Promise<string> {
  return signJsonToken({ ...reading, question: truncateQuestion(reading.question) }, secret);
}

export async function verifyLastReadingToken(
  token: string | undefined | null,
  secret: string
): Promise<LastReading | null> {
  const data = await readJsonToken(token, secret);
  if (!isLastReading(data)) return null;
  if (Date.now() - data.ts > LAST_READING_TTL_MS) return null;
  return data;
}

function isLastReading(value: unknown): value is LastReading {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  if (d.v !== 1) return false;
  if (typeof d.spread !== 'string' || !(d.spread in SPREADS)) return false;
  if (typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 64) return false;
  if (typeof d.question !== 'string' || d.question.length > PENDING_QUESTION_MAX_CHARS) return false;
  if (typeof d.ts !== 'number' || !Number.isFinite(d.ts)) return false;
  if (!Array.isArray(d.verses)) return false;
  if (d.verses.length < 1 || d.verses.length > PENDING_DRAW_MAX_ITEMS) return false;
  return d.verses.every((r) => typeof r === 'string' && r.length > 0 && r.length <= 64);
}
