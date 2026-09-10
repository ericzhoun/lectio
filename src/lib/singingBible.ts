import { parseReference } from './passage';
import { BOOK_NR } from './scripture';
import manifest from './singingBibleClips.json';

export interface MusicClip { file: string; duration: number }
export type MusicCatalog = Record<string, MusicClip>;

/** Same reference normalization as the displayed daily passage. */
export function musicKey(reference: string): string | null {
  const parsed = parseReference(reference);
  if (!parsed) return null;
  const book = BOOK_NR[parsed.book === 'Psalm' ? 'Psalms' : parsed.book];
  if (!book) return null;
  return `${book}:${parsed.from.chapter}:${parsed.from.verse}-${parsed.to.chapter}:${parsed.to.verse}`;
}

/** Only pre-cut, complete passages are playable. No chapter/timestamp fallback. */
export function resolveMusic(reference: string, catalog: MusicCatalog = manifest): MusicClip | null {
  const key = musicKey(reference);
  const clip = key ? catalog[key] : undefined;
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 ||
      !/^\/music\/singing-bible\/[a-z0-9-]+\.mp3$/.test(clip.file)) return null;
  return clip;
}
