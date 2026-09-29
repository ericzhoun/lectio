import { describe, it, expect } from 'vitest';
import { chapterContextForRef, chapterKeyForRef, relatedByBook } from '../verseContext';
import { getLibraryVerses } from '../scripture';

describe('chapterKeyForRef', () => {
  it('maps a reference onto its bibleChapters key', () => {
    expect(chapterKeyForRef('James 1:3')).toBe('59:1');
    expect(chapterKeyForRef('Psalm 23:1')).toBe('19:23');
    expect(chapterKeyForRef('1 Corinthians 13:4-5')).toBe('46:13');
  });

  it('returns null for malformed references or unknown books', () => {
    expect(chapterKeyForRef('Not a reference')).toBeNull();
    expect(chapterKeyForRef('Hezekiah 3:1')).toBeNull();
  });
});

describe('chapterContextForRef', () => {
  it('embeds the verse in its chapter with the neighbouring window', () => {
    const ctx = chapterContextForRef('James 1:3', '雅各书 1:3');
    if (!ctx) throw new Error('expected James 1 context');
    expect(ctx.bookEn).toBe('James');
    expect(ctx.bookZh).toBe('雅各书');
    expect(ctx.chapter).toBe(1);
    expect(ctx.verses[0]!.num).toBe(1); // 3 − 6 clamps to verse 1
    expect(ctx.startsOpen).toBe(false);
    expect(ctx.endsOpen).toBe(true); // James 1 has 27 verses
    const focus = ctx.verses.filter((v) => v.isFocus);
    expect(focus.map((v) => v.num)).toEqual([3]);
    expect(focus[0]!.isRangeStart).toBe(true);
    expect(focus[0]!.textEn).toContain('testing of your faith');
    expect(focus[0]!.textZh).toContain('信心经过试验');
  });

  it('marks every verse of a focused range', () => {
    const ctx = chapterContextForRef('1 Corinthians 13:4-5', '哥林多前书 13:4-5');
    if (!ctx) throw new Error('expected 1 Corinthians 13 context');
    expect(ctx.verses.filter((v) => v.isFocus).map((v) => v.num)).toEqual([4, 5]);
    const second = ctx.verses.find((v) => v.num === 5)!;
    expect(second.isRangeStart).toBe(false);
  });

  it('returns null for the two deck verses without chapter data', () => {
    expect(chapterContextForRef('Proverbs 30:8-9', '箴言 30:8-9')).toBeNull();
    expect(chapterContextForRef('2 Corinthians 10:2-6', '哥林多后书 10:2-6')).toBeNull();
  });

  it('covers every other deck verse', () => {
    const gaps = new Set(['Proverbs 30:8-9', '2 Corinthians 10:2-6']);
    for (const v of getLibraryVerses()) {
      const ctx = chapterContextForRef(v.refEn, v.refZh);
      if (gaps.has(v.refEn)) {
        expect(ctx).toBeNull();
      } else {
        expect(ctx, v.refEn).not.toBeNull();
      }
    }
  });
});

describe('relatedByBook', () => {
  it('lists other verses from the same book in chapter/verse order', () => {
    const related = relatedByBook('James 1:3');
    expect(related.map((v) => v.refEn)).toEqual([
      'James 1:2-3', 'James 1:5', 'James 1:22', 'James 2:17', 'James 3:17',
    ]);
  });

  it('never includes the page\'s own verse and honours the cap', () => {
    const related = relatedByBook('Psalm 23:1', 3);
    expect(related).toHaveLength(3);
    expect(related.some((v) => v.refEn === 'Psalm 23:1')).toBe(false);
  });

  it('returns nothing for single-verse books', () => {
    expect(relatedByBook('1 Samuel 16:7')).toEqual([]);
  });

  it('returns nothing for unknown books', () => {
    expect(relatedByBook('Hezekiah 3:1')).toEqual([]);
  });
});
