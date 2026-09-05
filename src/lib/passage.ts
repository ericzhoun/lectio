// Resolve a lectionary reference like 'John 7:53--8:11' to public-domain text.
//
// The daily lectionary's focus reading is always the gospel, which spans 91
// chapters across 8 books - small enough to keep in the bundled chapter data
// alongside the deck's own chapters.
import bibleChapters from './bibleChapters.json';
import { BOOK_NR } from './scripture';
import type { Lang } from './reading';

/** Chapters keyed '<bookNumber>:<chapter>', verses zero-indexed. */
export type ChapterStore = Record<string, { en: string[]; zh: string[] }>;

export interface VersePoint {
  chapter: number;
  verse: number;
}

export interface ParsedReference {
  book: string;
  from: VersePoint;
  to: VersePoint;
}

export interface ResolvedPassage {
  ref: string;
  text: string;
}

/**
 * The BCP abbreviates book names, and not always the same way ('Matt.', 'Mat').
 * Only the books the daily lectionary actually reaches need an entry; anything
 * unlisted falls through to the full name.
 */
const ABBREVIATIONS: Record<string, string> = {
  matt: 'Matthew',
  mat: 'Matthew',
  mk: 'Mark',
  lk: 'Luke',
  jn: 'John',
  rom: 'Romans',
  cor: 'Corinthians',
  gal: 'Galatians',
  eph: 'Ephesians',
  phil: 'Philippians',
  col: 'Colossians',
  thess: 'Thessalonians',
  tim: 'Timothy',
  heb: 'Hebrews',
  pet: 'Peter',
  rev: 'Revelation',
  isa: 'Isaiah',
  jer: 'Jeremiah',
  ezek: 'Ezekiel',
  exod: 'Exodus',
  deut: 'Deuteronomy',
  eccl: 'Ecclesiastes',
  zech: 'Zechariah',
  mic: 'Micah',
  hab: 'Habakkuk',
  hag: 'Haggai',
  lam: 'Lamentations',
  num: 'Numbers',
  josh: 'Joshua',
  judg: 'Judges',
  chron: 'Chronicles',
  neh: 'Nehemiah',
  prov: 'Proverbs',
  ps: 'Psalms',
};

/** 'Matt.' -> 'Matthew'; '1 Thess.' -> '1 Thessalonians'. */
function expandBook(raw: string): string {
  const trimmed = raw.trim().replace(/\.$/, '');
  const numbered = trimmed.match(/^([1-3])\s+(.+)$/);
  const prefix = numbered ? `${numbered[1]} ` : '';
  const name = (numbered ? numbered[2] : trimmed).replace(/\.$/, '');
  const expanded = ABBREVIATIONS[name.toLowerCase()] ?? name;
  return `${prefix}${expanded}`;
}

/**
 * Parse a reference into the span it covers.
 *
 * The BCP writes ranges several ways, and all of them resolve to one
 * contiguous span here: a comma range ('John 11:17-27, 38-44') is read whole,
 * and bracketed optional verses ('Mark 16:1-8(9-20)') are included. A few
 * verses either side make no difference to a slow reading, and a second
 * grammar would.
 */
export function parseReference(ref: string): ParsedReference | null {
  if (!ref) return null;

  const m = ref.match(/^\s*((?:[1-3]\s+)?[A-Za-z][A-Za-z\s.]*?)\s+(\d+\s*:.*)$/);
  if (!m) return null;

  const book = expandBook(m[1]);
  // Brackets mark optional verses; the numbers inside are part of the span.
  const body = m[2].replace(/[()[\]]/g, ' ');

  // Every 'chapter:verse' anchor, in order.
  const matches = [...body.matchAll(/(\d+)\s*:\s*(\d+)/g)];
  if (matches.length === 0) return null;
  const anchors = matches.map((a) => ({ chapter: Number(a[1]), verse: Number(a[2]) }));

  const from = anchors[0];
  const last = anchors[anchors.length - 1];

  // Any bare numbers after the final anchor are further verses in its chapter.
  // Sliced from the end of that anchor, so the chapter number is not re-read
  // as a verse.
  const lastMatch = matches[matches.length - 1];
  const tail = body.slice((lastMatch.index ?? 0) + lastMatch[0].length);
  const trailing = [...tail.matchAll(/\d+/g)].map((t) => Number(t[0]));
  const endVerse = Math.max(last.verse, ...trailing);

  return {
    book,
    from,
    to: { chapter: last.chapter, verse: endVerse },
  };
}

const BUNDLED = bibleChapters as unknown as ChapterStore;

export function resolvePassage(
  ref: string,
  lang: Lang,
  store: ChapterStore = BUNDLED
): ResolvedPassage | null {
  const parsed = parseReference(ref);
  if (!parsed) return null;

  const nr = BOOK_NR[parsed.book];
  if (!nr) return null;

  const parts: string[] = [];
  for (let chapter = parsed.from.chapter; chapter <= parsed.to.chapter; chapter++) {
    const found = store[`${nr}:${chapter}`];
    // A reading that crosses a chapter boundary needs both chapters; without
    // one, return nothing rather than half a passage.
    if (!found) return null;

    const verses = lang === 'zh' ? found.zh : found.en;
    const first = chapter === parsed.from.chapter ? parsed.from.verse : 1;
    // Clamp to the chapter: versification differs slightly between
    // translations, and a short passage beats no passage.
    const lastVerse = chapter === parsed.to.chapter
      ? Math.min(parsed.to.verse, verses.length)
      : verses.length;
    if (first > verses.length) return null;

    parts.push(...verses.slice(first - 1, lastVerse).filter(Boolean));
  }

  if (parts.length === 0) return null;
  return { ref, text: parts.join(' ') };
}
