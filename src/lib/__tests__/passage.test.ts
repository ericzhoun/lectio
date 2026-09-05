import { describe, it, expect } from 'vitest';
import { parseReference, resolvePassage, type ChapterStore } from '../passage';
import { getLectionaryDay, focusReference } from '../lectionary';
import lectionaryDays from '../lectionaryDays.json';

// Two adjacent chapters, so a reading that crosses a chapter boundary can be
// exercised without leaning on the real text.
const store: ChapterStore = {
  '43:7': {
    en: Array.from({ length: 53 }, (_, i) => `John 7 verse ${i + 1}.`),
    zh: Array.from({ length: 53 }, (_, i) => `约七章第${i + 1}节。`),
  },
  '43:8': {
    en: Array.from({ length: 59 }, (_, i) => `John 8 verse ${i + 1}.`),
    zh: Array.from({ length: 59 }, (_, i) => `约八章第${i + 1}节。`),
  },
};

describe('parseReference', () => {
  it('parses a simple verse range', () => {
    expect(parseReference('John 7:1-5')).toEqual({
      book: 'John', from: { chapter: 7, verse: 1 }, to: { chapter: 7, verse: 5 },
    });
  });

  it('parses a single verse', () => {
    expect(parseReference('John 3:16')).toEqual({
      book: 'John', from: { chapter: 3, verse: 16 }, to: { chapter: 3, verse: 16 },
    });
  });

  it('expands the abbreviations the BCP uses', () => {
    expect(parseReference('Matt. 25:1-13')?.book).toBe('Matthew');
    expect(parseReference('Mark 1:1')?.book).toBe('Mark');
    expect(parseReference('Rom. 8:1-4')?.book).toBe('Romans');
  });

  it('spans a chapter boundary', () => {
    expect(parseReference('John 7:53--8:11')).toEqual({
      book: 'John', from: { chapter: 7, verse: 53 }, to: { chapter: 8, verse: 11 },
    });
    expect(parseReference('Luke 20:41--21:4')).toEqual({
      book: 'Luke', from: { chapter: 20, verse: 41 }, to: { chapter: 21, verse: 4 },
    });
  });

  it('takes the contiguous span of a comma range', () => {
    // A few extra verses are harmless in a contemplative reading, and a second
    // grammar is not worth it.
    expect(parseReference('John 11:17-27, 38-44')).toEqual({
      book: 'John', from: { chapter: 11, verse: 17 }, to: { chapter: 11, verse: 44 },
    });
  });

  it('includes the optional verses the BCP brackets', () => {
    expect(parseReference('Mark 16:1-8(9-20)')).toEqual({
      book: 'Mark', from: { chapter: 16, verse: 1 }, to: { chapter: 16, verse: 20 },
    });
    expect(parseReference('John 1:(29-34)35-42')).toEqual({
      book: 'John', from: { chapter: 1, verse: 29 }, to: { chapter: 1, verse: 42 },
    });
  });

  it('returns null for junk', () => {
    expect(parseReference('not a reference')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});

describe('resolvePassage', () => {
  it('joins a verse range in both languages', () => {
    const en = resolvePassage('John 7:1-3', 'en', store);
    const zh = resolvePassage('John 7:1-3', 'zh', store);
    expect(en?.text).toBe('John 7 verse 1. John 7 verse 2. John 7 verse 3.');
    expect(zh?.text).toContain('约七章第1节。');
    expect(en?.ref).toBe('John 7:1-3');
  });

  it('reads across a chapter boundary', () => {
    const passage = resolvePassage('John 7:52--8:2', 'en', store);
    expect(passage?.text).toBe(
      'John 7 verse 52. John 7 verse 53. John 8 verse 1. John 8 verse 2.'
    );
  });

  it('returns null when the chapter is absent', () => {
    expect(resolvePassage('Mark 1:1-3', 'en', store)).toBeNull();
  });

  it('clamps a range that overruns the chapter rather than returning nothing', () => {
    // The BCP's optional-verse brackets sometimes reach past the chapter as the
    // WEB versification counts it; a short passage beats no passage.
    const passage = resolvePassage('John 8:57-70', 'en', store);
    expect(passage?.text).toContain('John 8 verse 59.');
  });

  it('shows the reference in Chinese for a Chinese reader', () => {
    expect(resolvePassage('John 7:1-3', 'zh', store)?.ref).toBe('约翰福音 7:1-3');
    // English is unchanged.
    expect(resolvePassage('John 7:1-3', 'en', store)?.ref).toBe('John 7:1-3');
  });

  it('returns null for an unparseable reference', () => {
    expect(resolvePassage('nonsense', 'en', store)).toBeNull();
  });
});

describe('the shipped lectionary', () => {
  it('resolves every focus reading in the generated window', () => {
    const unresolved: string[] = [];
    for (const day of Object.keys(lectionaryDays)) {
      const ref = focusReference(getLectionaryDay(day));
      if (!resolvePassage(ref, 'en')) unresolved.push(`${day}: ${ref}`);
    }
    expect(unresolved).toEqual([]);
  });

  it('resolves every focus reading in Chinese too', () => {
    const unresolved: string[] = [];
    for (const day of Object.keys(lectionaryDays)) {
      const ref = focusReference(getLectionaryDay(day));
      if (!resolvePassage(ref, 'zh')) unresolved.push(`${day}: ${ref}`);
    }
    expect(unresolved).toEqual([]);
  });
});
