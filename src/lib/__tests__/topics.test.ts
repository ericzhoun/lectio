import { describe, it, expect } from 'vitest';
import { TOPICS, getTopicBySlug, topicVerses, topicsForVerse } from '../topics';
import { getLibraryVerseByRef } from '../scripture';

describe('TOPICS', () => {
  it('has unique slugs and non-empty bilingual metadata', () => {
    const slugs = TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(TOPICS.length).toBeGreaterThanOrEqual(10);
    for (const t of TOPICS) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
      expect(t.nameEn.length).toBeGreaterThan(0);
      expect(t.nameZh.length).toBeGreaterThan(0);
      expect(t.descEn.length).toBeGreaterThan(0);
      expect(t.descZh.length).toBeGreaterThan(0);
      expect(t.refs.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('references only deck verses, without duplicates', () => {
    for (const t of TOPICS) {
      const seen = new Set<string>();
      for (const ref of t.refs) {
        expect(getLibraryVerseByRef(ref), `${t.slug}: ${ref}`).not.toBeNull();
        expect(seen.has(ref), `${t.slug}: duplicate ${ref}`).toBe(false);
        seen.add(ref);
      }
    }
  });
});

describe('topicVerses', () => {
  it('resolves a topic to library entries in topic order', () => {
    const topic = getTopicBySlug('anxiety');
    if (!topic) throw new Error('expected the anxiety topic');
    const verses = topicVerses(topic);
    expect(verses).toHaveLength(topic.refs.length);
    expect(verses.map((v) => v.refEn)).toEqual([...topic.refs]);
    expect(verses[0]!.slug).toBe('philippians-4-6-7');
  });
});

describe('topicsForVerse', () => {
  it('indexes a verse back to the topics that contain it', () => {
    expect(topicsForVerse('John 3:16').map((t) => t.slug)).toContain('gods-love');
    expect(topicsForVerse('Genesis 1:1').map((t) => t.slug)).toEqual(['beginnings']);
  });

  it('returns nothing for verses no topic lists', () => {
    expect(topicsForVerse('No Such 9:9')).toEqual([]);
  });
});

describe('getTopicBySlug', () => {
  it('resolves known slugs and rejects unknown ones', () => {
    expect(getTopicBySlug('anxiety')?.nameEn).toBe('Anxiety and Peace');
    expect(getTopicBySlug('does-not-exist')).toBeNull();
  });
});
