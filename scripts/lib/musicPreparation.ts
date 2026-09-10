import { parseReference } from '../../src/lib/passage';
import { BOOK_NR } from '../../src/lib/scripture';
export interface TimedVerse { start: number; end: number; score: number }
export interface TimedChapter { file: string; sha256: string; duration: number; verses: Record<string, TimedVerse> }
export type Timings = Record<string, TimedChapter>;
export interface MusicCut { file: string; start: number; end: number; sha256: string }
export function numberLyricLines(lines: string[], verses: { v: number; t: string }[]): number[] | null {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const numbered = verses.filter(v => words(v.t).length);
  if (lines.length !== numbered.length) return null;
  for (const [i, line] of lines.entries()) {
    const a = words(line), b = words(numbered[i].t);
    const remaining = [...b];
    let shared = 0;
    for (const word of a) {
      const at = remaining.indexOf(word);
      if (at >= 0) { shared++; remaining.splice(at, 1); }
    }
    if (2 * shared / (a.length + b.length) < .65) return null;
  }
  return numbered.map(v => v.v);
}
export function planMusicCuts(reference: string, timings: Timings): MusicCut[] | null {
  const ref = parseReference(reference);
  if (!ref || ref.to.chapter < ref.from.chapter) return null;
  const nr = BOOK_NR[ref.book];
  const cuts: MusicCut[] = [];
  for (let c = ref.from.chapter; c <= ref.to.chapter; c++) {
    const chapter = timings[`${nr}:${c}`];
    if (!chapter || !Number.isFinite(chapter.duration) || chapter.duration <= 0) return null;
    const numbers = Object.keys(chapter.verses).map(Number).sort((a, b) => a - b);
    const first = c === ref.from.chapter ? ref.from.verse : 1;
    const last = c === ref.to.chapter ? ref.to.verse : Math.max(...numbers);
    if (first < 1 || last < first) return null;
    let previousEnd = 0;
    for (let v = first; v <= last; v++) {
      const verse = chapter.verses[v];
      if (!verse || ![verse.start, verse.end, verse.score].every(Number.isFinite) ||
          verse.start < previousEnd || verse.end <= verse.start || verse.end > chapter.duration || verse.score < .65) return null;
      previousEnd = verse.end;
    }
    const before = chapter.verses[numbers.filter(v => v < first).at(-1) ?? 0];
    const after = chapter.verses[numbers.find(v => v > last) ?? 0];
    const start = Math.max(0, chapter.verses[first].start - .12, before ? (before.end + chapter.verses[first].start) / 2 : 0);
    const end = Math.min(chapter.duration, chapter.verses[last].end + .25, after ? (after.start + chapter.verses[last].end) / 2 : chapter.duration);
    if (end <= start) return null;
    cuts.push({ file: chapter.file, sha256: chapter.sha256, start, end });
  }
  return cuts.length ? cuts : null;
}
