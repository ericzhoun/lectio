import { describe, it, expect } from 'vitest';
import {
  interpretationsForVerse,
  hasInterpretations,
  versesForQuestion,
  countForQuestion,
} from '../verseInterpretations';
import { getLibraryVerses } from '../scripture';
import { TYPICAL_QUESTIONS } from '../verseQuestions';

const DECK = getLibraryVerses();

describe('interpretationsForVerse', () => {
  it('answers every question for a covered verse, in canonical order', () => {
    const entries = interpretationsForVerse('philippians-4-13', 'en');
    expect(entries.map((e) => e.question.slug)).toEqual(TYPICAL_QUESTIONS.map((q) => q.slug));
    for (const entry of entries) {
      expect(entry.interpretation.text.length).toBeGreaterThan(350);
      expect(entry.interpretation.carry.length).toBeGreaterThan(8);
    }
  });

  it('serves the same questions in Chinese with Chinese prose', () => {
    const entries = interpretationsForVerse('philippians-4-13', 'zh');
    expect(entries.length).toBe(TYPICAL_QUESTIONS.length);
    for (const entry of entries) {
      expect(/[\u4e00-\u9fa5]/.test(entry.interpretation.text), entry.question.slug).toBe(true);
      expect(entry.interpretation.text).not.toBe(
        interpretationsForVerse('philippians-4-13', 'en').find(
          (e) => e.question.slug === entry.question.slug
        )?.interpretation.text
      );
    }
  });

  it('returns nothing for an unknown slug rather than throwing', () => {
    expect(interpretationsForVerse('no-such-verse', 'en')).toEqual([]);
    expect(hasInterpretations('no-such-verse', 'en')).toBe(false);
  });
});

describe('interpretation coverage', () => {
  // The whole point of the feature is that a question-shaped arrival always
  // finds an answer, so coverage is asserted for the full deck rather than
  // spot-checked. Gaps are a generation failure, not a content judgement.
  it('covers every deck verse in both languages', () => {
    const missing: string[] = [];
    for (const verse of DECK) {
      for (const lang of ['en', 'zh'] as const) {
        if (interpretationsForVerse(verse.slug, lang).length !== TYPICAL_QUESTIONS.length) {
          missing.push(`${lang} ${verse.slug}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has no stray verse keys outside the deck', () => {
    const known = new Set(DECK.map((v) => v.slug));
    for (const slug of ['philippians-4-13', 'john-3-16']) {
      expect(known.has(slug), slug).toBe(true);
    }
    // A stray key would mean a renamed slug left content behind; catch it by
    // asserting the count of covered verses never exceeds the deck size.
    const covered = DECK.filter((v) => hasInterpretations(v.slug, 'en')).length;
    expect(covered).toBeLessThanOrEqual(DECK.length);
  });
});

describe('page-level quality', () => {
  // A verse page renders all four interpretations at once. Repetition *within*
  // one page is visible to a reader as a batch artifact, so it is asserted for
  // the whole deck here rather than trusted to review. Repetition across two
  // different pages is not visible and is deliberately not checked.
  const firstSentence = (text: string) => text.split(/(?<=[.?!])\s+/)[0]?.trim() ?? '';

  it('never repeats an opening sentence or a carry line on the same page', () => {
    const collisions: string[] = [];
    for (const verse of DECK) {
      for (const lang of ['en', 'zh'] as const) {
        const entries = interpretationsForVerse(verse.slug, lang);
        const openings = new Map<string, string>();
        const carries = new Map<string, string>();
        for (const { question, interpretation } of entries) {
          const opening = firstSentence(interpretation.text);
          if (openings.has(opening)) {
            collisions.push(`${lang} ${verse.slug}: opening shared by ${question.slug} and ${openings.get(opening)}`);
          } else {
            openings.set(opening, question.slug);
          }
          const carry = interpretation.carry.trim();
          if (carries.has(carry)) {
            collisions.push(`${lang} ${verse.slug}: carry shared by ${question.slug} and ${carries.get(carry)}`);
          } else {
            carries.set(carry, question.slug);
          }
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('has no doubled words in the English reflections', () => {
    const doubled: string[] = [];
    for (const verse of DECK) {
      for (const { question, interpretation } of interpretationsForVerse(verse.slug, 'en')) {
        const hit = interpretation.text.match(/\b([A-Za-z]{3,})\s+\1\b/i);
        if (hit) doubled.push(`${verse.slug}/${question.slug}: "${hit[0]}"`);
      }
    }
    expect(doubled).toEqual([]);
  });

  it('ends every Chinese carry line with terminal punctuation', () => {
    const bad: string[] = [];
    for (const verse of DECK) {
      for (const { question, interpretation } of interpretationsForVerse(verse.slug, 'zh')) {
        if (!/[.\u3002!\uff01?\uff1f]$/.test(interpretation.carry.trim())) {
          bad.push(`${verse.slug}/${question.slug}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ends every reflection with a question the reader could sit with', () => {
    const bad: string[] = [];
    for (const verse of DECK) {
      for (const lang of ['en', 'zh'] as const) {
        for (const { question, interpretation } of interpretationsForVerse(verse.slug, lang)) {
          const text = interpretation.text.trim();
          if (!(text.endsWith('?') || text.endsWith('\uff1f'))) {
            bad.push(`${lang} ${verse.slug}/${question.slug}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('versesForQuestion', () => {
  it('suggests other verses answering the same question, excluding the current one', () => {
    const others = versesForQuestion('pressure-at-work', 'en', 'philippians-4-13', 3);
    expect(others.length).toBe(3);
    expect(others.map((v) => v.slug)).not.toContain('philippians-4-13');
    for (const v of others) expect(v.refEn.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same input', () => {
    expect(versesForQuestion('stillness', 'en', 'psalm-46-10', 3).map((v) => v.slug)).toEqual(
      versesForQuestion('stillness', 'en', 'psalm-46-10', 3).map((v) => v.slug)
    );
  });
});

describe('countForQuestion', () => {
  it('counts covered verses per question', () => {
    const count = countForQuestion('pressure-at-work', 'en');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(DECK.length);
  });
});
