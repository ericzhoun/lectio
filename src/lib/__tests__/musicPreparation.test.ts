import { describe, expect, it } from 'vitest';
import { planMusicCuts, numberLyricLines, type TimedChapter } from '../../../scripts/lib/musicPreparation';

const chapter: TimedChapter = { file: '43-john/003.mp3', sha256: 'test', duration: 60, verses: {
  '15': { start: 8, end: 9.9, score: .95 },
  '16': { start: 10, end: 20, score: .95 },
  '17': { start: 20.1, end: 30, score: .95 },
} };
describe('music preprocessing', () => {
  it('uses explicit verse numbers even when the translation omits a verse', () => {
    expect(numberLyricLines(['The first verse.', 'The next verse.'], [
      { v: 20, t: 'The first verse.' }, { v: 22, t: 'The next verse.' },
    ])).toEqual([20, 22]);
  });
  it('allows minor wording differences but rejects unrelated or shifted lyric lines', () => {
    expect(numberLyricLines(['The name of the first river is the Pishon.'], [
      { v: 11, t: 'The name of the first river is Pishon.' },
    ])).toEqual([11]);
    expect(numberLyricLines(['An unrelated song.'], [{ v: 11, t: 'The name of the first river is Pishon.' }])).toBeNull();
    expect(numberLyricLines(['The first verse.', 'Extra line'], [{ v: 1, t: 'The first verse.' }])).toBeNull();
  });
  it('pads within neighboring verses, never includes their sung words', () => {
    const cuts = planMusicCuts('John 3:16', { '43:3': chapter });
    expect(cuts).toHaveLength(1);
    expect(cuts![0].start).toBeGreaterThanOrEqual(9.9);
    expect(cuts![0].start).toBeLessThanOrEqual(10);
    expect(cuts![0].end).toBeGreaterThanOrEqual(20);
    expect(cuts![0].end).toBeLessThanOrEqual(20.1);
  });
  it('rejects missing or low-confidence verses rather than exporting partial readings', () => {
    expect(planMusicCuts('John 3:16-18', { '43:3': chapter })).toBeNull();
    expect(planMusicCuts('John 3:16', { '43:3': { ...chapter, verses: {
      '16': { start: 10, end: 20, score: .2 },
    } } })).toBeNull();
  });
  it('assembles a cross-chapter reading only when both chapters are covered', () => {
    const next = { ...chapter, file: '43-john/004.mp3', verses: { '1': { start: 2, end: 6, score: .95 } } };
    expect(planMusicCuts('John 3:17--4:1', { '43:3': chapter })).toBeNull();
    expect(planMusicCuts('John 3:17--4:1', { '43:3': chapter, '43:4': next })).toHaveLength(2);
  });
});
