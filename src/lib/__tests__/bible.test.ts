import { describe, it, expect } from 'vitest';
import { BIBLE_SPREADS, BIBLE_VERSES, drawVerses, rebuildDrawnVerses, buildBiblePages, type DrawnVerse } from '../bible';
import { SPREADS } from '../tarot';

describe('bible verse deck', () => {
  it('has 78 unique English references (mirroring the 78-card tarot deck)', () => {
    expect(BIBLE_VERSES).toHaveLength(78);
    const refs = new Set(BIBLE_VERSES.map((v) => v.en.ref));
    expect(refs.size).toBe(78);
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
    expect(drawVerses(100)).toHaveLength(78);
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

describe('BIBLE_SPREADS', () => {
  it('shares keys, card counts, and position labels with the tarot spreads', () => {
    for (const key of Object.keys(SPREADS)) {
      expect(BIBLE_SPREADS[key]).toBeDefined();
      expect(BIBLE_SPREADS[key].number).toBe(SPREADS[key].number);
      expect(BIBLE_SPREADS[key].positions.en).toEqual(SPREADS[key].positions.en);
      expect(BIBLE_SPREADS[key].positions.zh).toEqual(SPREADS[key].positions.zh);
    }
  });

  it('uses the Celtic Cross positions for the 10-verse layout', () => {
    expect(BIBLE_SPREADS.celtic_cross.number).toBe(10);
    expect(BIBLE_SPREADS.celtic_cross.positions.en).toEqual([
      'Present Situation', 'Challenge', 'Distant Past', 'Recent Past', 'Best Outcome',
      'Near Future', 'Your Attitude', 'External Influences', 'Hopes and Fears', 'Final Outcome',
    ]);
  });
});
