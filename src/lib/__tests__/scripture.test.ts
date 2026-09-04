import { describe, it, expect } from 'vitest';
import {
  BIBLE_VERSES, drawVerses, rebuildDrawnVerses, buildBiblePages,
  getLibraryVerses, verseSlug, type DrawnVerse,
} from '../scripture';
import { SPREADS } from '../reading';

describe('scripture verse deck', () => {
  it('has 148 unique English references', () => {
    expect(BIBLE_VERSES).toHaveLength(148);
    const refs = new Set(BIBLE_VERSES.map((v) => v.en.ref));
    expect(refs.size).toBe(148);
  });

  it('has non-empty ref, text, and theme in both languages', () => {
    for (const v of BIBLE_VERSES) {
      expect(v.en.ref.length).toBeGreaterThan(0);
      expect(v.en.text.length).toBeGreaterThan(0);
      expect(v.en.theme.length).toBeGreaterThan(0);
      expect(v.zh.ref.length).toBeGreaterThan(0);
      expect(v.zh.text.length).toBeGreaterThan(0);
      expect(v.zh.theme.length).toBeGreaterThan(0);
    }
  });
});

describe('drawVerses', () => {
  it('returns the requested number of unique verses', () => {
    const drawn = drawVerses(5);
    expect(drawn).toHaveLength(5);
    const refs = new Set(drawn.map((v) => v.refEn));
    expect(refs.size).toBe(5);
  });

  it('defaults to a single verse', () => {
    expect(drawVerses()).toHaveLength(1);
  });

  it('clamps the count to the deck size', () => {
    expect(drawVerses(200)).toHaveLength(148);
  });

  it('carries through both languages and themes', () => {
    const [v] = drawVerses(1);
    expect(v.refEn).toMatch(/\d+:?\d*$/);
    expect(v.refZh).toMatch(/\d+:?\d*$/);
    expect(v.textEn.length).toBeGreaterThan(0);
    expect(v.textZh.length).toBeGreaterThan(0);
    expect(v.themeEn.length).toBeGreaterThan(0);
    expect(v.themeZh.length).toBeGreaterThan(0);
  });
});

describe('rebuildDrawnVerses', () => {
  it('restores exact verses from English refs and skips unknown refs', () => {
    const drawn = drawVerses(3);
    const refs = drawn.map((v) => v.refEn);
    const rebuilt = rebuildDrawnVerses([...refs, 'Not A Verse 9:99']);
    expect(rebuilt).toHaveLength(3);
    expect(rebuilt.map((v) => v.refEn)).toEqual(refs);
    for (const v of rebuilt) {
      expect(v.textEn.length).toBeGreaterThan(0);
      expect(v.textZh.length).toBeGreaterThan(0);
      expect(v.themeEn.length).toBeGreaterThan(0);
      expect(v.themeZh.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates repeated refs', () => {
    const [v] = drawVerses(1);
    const rebuilt = rebuildDrawnVerses([v.refEn, v.refEn]);
    expect(rebuilt).toHaveLength(1);
  });

  it('can rebuild a full 10-verse celtic draw', () => {
    const refs = BIBLE_VERSES.slice(0, 10).map((v) => v.en.ref);
    expect(rebuildDrawnVerses(refs)).toHaveLength(10);
  });
});

describe('buildBiblePages', () => {
  const v = (refEn: string, refZh: string): DrawnVerse => ({
    refEn, refZh, textEn: 'deck text', textZh: '经文', themeEn: '', themeZh: '',
  });

  it('embeds a drawn verse in its chapter with neighbouring verses', () => {
    const pages = buildBiblePages([v('John 3:16', '约翰福音 3:16')]);
    expect(pages).toHaveLength(1);
    const page = pages[0];
    expect(page.bookEn).toBe('John');
    expect(page.bookZh).toBe('约翰福音');
    expect(page.chapter).toBe(3);
    const nums = page.verses.map((x) => x.num);
    expect(nums).toContain(15);
    expect(nums).toContain(16);
    expect(nums).toContain(17);
    expect(nums.length).toBeLessThanOrEqual(13); // ±6 window
    const drawn = page.verses.filter((x) => x.drawnIndex >= 0);
    expect(drawn.map((x) => x.num)).toEqual([16]);
    expect(drawn[0].isRangeStart).toBe(true);
    expect(page.startsOpen).toBe(true);
    expect(page.endsOpen).toBe(true);
    expect(page.verses.every((x) => x.textEn.length > 0 && x.textZh.length > 0)).toBe(true);
  });

  it('marks every verse of a drawn range (position tag on the first only)', () => {
    const pages = buildBiblePages([v('1 Corinthians 13:4-5', '哥林多前书 13:4-5')]);
    const drawn = pages[0].verses.filter((x) => x.drawnIndex >= 0);
    expect(drawn.map((x) => x.num)).toEqual([4, 5]);
    expect(drawn[0].isRangeStart).toBe(true);
    expect(drawn[1].isRangeStart).toBe(false);
  });

  it('merges drawn verses from the same chapter into one page', () => {
    const pages = buildBiblePages([v('Matthew 11:28', '马太福音 11:28'), v('Matthew 11:29', '马太福音 11:29')]);
    expect(pages).toHaveLength(1);
    expect(pages[0].verses.filter((x) => x.drawnIndex >= 0).map((x) => x.num)).toEqual([28, 29]);
  });

  it('orders pages by draw order', () => {
    const pages = buildBiblePages([v('Romans 8:28', '罗马书 8:28'), v('John 3:16', '约翰福音 3:16')]);
    expect(pages.map((p) => p.bookEn)).toEqual(['Romans', 'John']);
  });

  it('falls back to the deck verse alone when chapter data is missing', () => {
    const pages = buildBiblePages([v('Acts 2:1', '使徒行传 2:1')]);
    expect(pages).toHaveLength(1);
    expect(pages[0].verses).toHaveLength(1);
    expect(pages[0].verses[0].textEn).toBe('deck text');
    expect(pages[0].startsOpen).toBe(false);
    expect(pages[0].endsOpen).toBe(false);
  });
});

describe('layouts', () => {
  it('gives every layout as many positions as it draws verses', () => {
    for (const [key, spread] of Object.entries(SPREADS)) {
      expect(spread.positions.en, key).toHaveLength(spread.number);
      expect(spread.positions.zh, key).toHaveLength(spread.number);
    }
  });

  it('never draws more verses than the deck holds', () => {
    for (const spread of Object.values(SPREADS)) {
      expect(spread.number).toBeLessThanOrEqual(BIBLE_VERSES.length);
    }
  });
});

describe('verse library', () => {
  it('exposes every deck verse with a unique slug', () => {
    const library = getLibraryVerses();
    expect(library).toHaveLength(BIBLE_VERSES.length);
    expect(new Set(library.map((v) => v.slug)).size).toBe(BIBLE_VERSES.length);
  });

  it('slugs references URL-safely', () => {
    expect(verseSlug('John 3:16')).toBe('john-3-16');
    expect(verseSlug('1 Peter 5:7')).toBe('1-peter-5-7');
    expect(verseSlug('Psalm 23:1-3')).toBe('psalm-23-1-3');
  });

  it('splits testaments at Matthew', () => {
    const library = getLibraryVerses();
    const john = library.find((v) => v.refEn.startsWith('John 3:16'));
    const psalm = library.find((v) => v.bookEn === 'Psalms' || v.bookEn === 'Psalm');
    expect(john?.testament).toBe('new');
    if (psalm) expect(psalm.testament).toBe('old');
  });
});
