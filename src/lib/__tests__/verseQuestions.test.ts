import { describe, it, expect } from 'vitest';
import { TYPICAL_QUESTIONS, getTypicalQuestion } from '../verseQuestions';
import { DEFAULT_QUESTIONS } from '../reading';

describe('TYPICAL_QUESTIONS', () => {
  it('has unique, url-safe slugs', () => {
    const slugs = TYPICAL_QUESTIONS.map((q) => q.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('is bilingual and complete', () => {
    for (const q of TYPICAL_QUESTIONS) {
      expect(q.questionEn.length).toBeGreaterThan(10);
      expect(q.questionZh.length).toBeGreaterThan(5);
      expect(q.labelEn.length).toBeGreaterThan(0);
      expect(q.labelZh.length).toBeGreaterThan(0);
      // Chinese copy must actually be Chinese, not an English placeholder.
      expect(/[\u4e00-\u9fa5]/.test(q.questionZh), q.slug).toBe(true);
    }
  });

  it('covers the home page questions that the library also answers', () => {
    // The library and the home page must not drift into two vocabularies: each
    // of the four library questions is one the home page already suggests.
    for (const q of TYPICAL_QUESTIONS) {
      expect(DEFAULT_QUESTIONS.en, q.slug).toContain(q.questionEn);
      expect(DEFAULT_QUESTIONS.zh, q.slug).toContain(q.questionZh);
    }
  });
});

describe('getTypicalQuestion', () => {
  it('resolves known slugs and rejects unknown ones', () => {
    expect(getTypicalQuestion('stillness')?.labelEn).toBe('Finding stillness');
    expect(getTypicalQuestion('nope')).toBeNull();
  });
});
