// Chapter context and same-book links for the verse library pages.
//
// A visitor often lands on /library/<slug> straight from a precise reference
// lookup ("james 1 3"). These helpers let that page answer with more than the
// lone verse: the passage inside its chapter (±neighbouring verses, from the
// same public-domain data the reading flow uses — World English Bible + 和合本,
// bundled as bibleChapters.json), and links to other deck verses from the same
// book.
//
// Kept out of scripture.ts so the deck file stays focused on the reading flow;
// the chapter-key scheme mirrors buildBiblePages there ('<bookNr>:<chapter>'
// into bibleChapters.json).

import bibleChapters from './bibleChapters.json';
import { BOOK_NR, getLibraryVerses, type LibraryVerse } from './scripture';

export interface VerseContextRow {
  num: number;
  textEn: string;
  textZh: string;
  /** True on the verse(s) the page is about — the reference that was looked up. */
  isFocus: boolean;
  /** True on the first verse of a focused range. */
  isRangeStart: boolean;
}

export interface VerseContextPage {
  bookEn: string;
  bookZh: string;
  chapter: number;
  /** True when the chapter holds verses before/after the shown window. */
  startsOpen: boolean;
  endsOpen: boolean;
  verses: VerseContextRow[];
}

interface ParsedRef {
  book: string;
  chapter: number;
  start: number;
  end: number;
}

function parseRef(refEn: string): ParsedRef | null {
  const m = refEn.match(/^((?:[1-3] )?[A-Za-z]+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return {
    book: m[1],
    chapter: Number(m[2]),
    start: Number(m[3]),
    end: m[4] ? Number(m[4]) : Number(m[3]),
  };
}

/** bibleChapters.json key for a reference ('James 1:3' -> '59:1'); null when unknown. */
export function chapterKeyForRef(refEn: string): string | null {
  const parsed = parseRef(refEn);
  if (!parsed) return null;
  const nr = BOOK_NR[parsed.book];
  if (nr === undefined) return null;
  return `${nr}:${parsed.chapter}`;
}

/**
 * Embed the referenced verse (or range) in its chapter with ±`windowSize`
 * neighbouring verses. Returns null when the reference is malformed or the
 * chapter is absent from bibleChapters.json.
 */
export function chapterContextForRef(
  refEn: string,
  refZh: string,
  windowSize = 6
): VerseContextPage | null {
  const parsed = parseRef(refEn);
  const key = chapterKeyForRef(refEn);
  if (!parsed || !key) return null;
  const data = (bibleChapters as Record<string, { en: string[]; zh: string[] }>)[key];
  if (!data) return null;

  const maxVerse = data.en.length;
  const from = Math.max(1, parsed.start - windowSize);
  const to = Math.min(maxVerse, parsed.end + windowSize);
  const zhBook = refZh.match(/^(\S+) (\d+):/);

  const verses: VerseContextRow[] = [];
  for (let n = from; n <= to; n++) {
    const isFocus = n >= parsed.start && n <= parsed.end;
    verses.push({
      num: n,
      textEn: data.en[n - 1] ?? '',
      textZh: data.zh[n - 1] ?? '',
      isFocus,
      isRangeStart: isFocus && n === parsed.start,
    });
  }

  return {
    bookEn: parsed.book,
    bookZh: zhBook ? zhBook[1] : '',
    chapter: parsed.chapter,
    startsOpen: from > 1,
    endsOpen: to < maxVerse,
    verses,
  };
}

/** chapter*1000 + first verse — a stable, data-independent order within a book. */
function verseOrder(v: LibraryVerse): number {
  const parsed = parseRef(v.refEn);
  return parsed ? parsed.chapter * 1000 + parsed.start : 0;
}

/**
 * Up to `max` other verses from the same book, in chapter/verse order. Empty
 * for books whose deck section holds one verse, and for unknown books.
 */
export function relatedByBook(refEn: string, max = 6): LibraryVerse[] {
  const parsed = parseRef(refEn);
  const nr = parsed ? BOOK_NR[parsed.book] : undefined;
  if (nr === undefined) return [];
  return getLibraryVerses()
    .filter((v) => {
      if (v.refEn === refEn) return false;
      const p = parseRef(v.refEn);
      return p !== null && BOOK_NR[p.book] === nr;
    })
    .sort((a, b) => verseOrder(a) - verseOrder(b))
    .slice(0, max);
}
