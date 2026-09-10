import { describe, expect, it } from 'vitest';
import { resolveMusic, musicKey, type MusicCatalog } from '../singingBible';
const clip = { file: '/music/singing-bible/43-3-16-17.mp3', duration: 20 };
const catalog: MusicCatalog = { '43:3:16-3:17': clip };
describe('preprocessed daily passage music', () => {
  it('normalizes Bible abbreviations to the same prepared clip', () => {
    expect(resolveMusic('Jn. 3:16-17', catalog)).toEqual(clip);
    expect(musicKey('John 3:16-17')).toBe('43:3:16-3:17');
  });
  it('requires an exact passage match, never a nearby verse or chapter', () => {
    for (const ref of ['John 3:15-17', 'John 3:16', 'John 3:16--4:2', 'Mark 1:1', 'invalid']) {
      expect(resolveMusic(ref, catalog)).toBeNull();
    }
  });
  it('rejects malformed assets and invalid durations', () => {
    for (const invalid of [
      { ...clip, duration: 0 }, { ...clip, duration: NaN },
      { ...clip, file: 'D:/private.mp3' }, { ...clip, file: '/music/singing-bible/../x.mp3' },
    ]) {
      expect(resolveMusic('John 3:16-17', { '43:3:16-3:17': invalid })).toBeNull();
    }
  });
});
