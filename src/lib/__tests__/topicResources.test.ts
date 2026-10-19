import { describe, it, expect } from 'vitest';
import { TOPIC_RESOURCES, getTopicResources, linkHref } from '../topicResources';
import { TOPICS } from '../topics';

const sections = Object.values(TOPIC_RESOURCES);

describe('TOPIC_RESOURCES', () => {
  it('attaches only to topics that exist', () => {
    const topicSlugs = new Set(TOPICS.map((t) => t.slug));
    expect(sections.length).toBeGreaterThan(0);
    for (const r of sections) {
      expect(topicSlugs.has(r.topicSlug), `unknown topic ${r.topicSlug}`).toBe(true);
      // The record is keyed by the same slug it declares.
      expect(TOPIC_RESOURCES[r.topicSlug]).toBe(r);
    }
  });

  it('has complete bilingual metadata', () => {
    for (const r of sections) {
      const scalars = [
        r.headingEn, r.headingZh,
        r.orgNameEn, r.orgNameZh,
        r.orgTaglineEn, r.orgTaglineZh,
        r.visionEn, r.visionZh,
        r.missionEn, r.missionZh,
        r.themesTitleEn, r.themesTitleZh,
        r.linksTitleEn, r.linksTitleZh,
        r.attributionEn, r.attributionZh,
      ];
      for (const field of scalars) {
        expect(field.length, `${r.topicSlug}: empty bilingual field`).toBeGreaterThan(0);
      }
      expect(r.introEn.length).toBeGreaterThan(0);
      expect(r.introZh.length).toBe(r.introEn.length);
      for (const paragraph of [...r.introEn, ...r.introZh]) {
        expect(paragraph.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries bilingual text for every theme and link', () => {
    for (const r of sections) {
      expect(r.themes.length).toBeGreaterThanOrEqual(3);
      expect(r.links.length).toBeGreaterThanOrEqual(3);
      for (const theme of r.themes) {
        expect(theme.textEn.length).toBeGreaterThan(0);
        expect(theme.textZh.length).toBeGreaterThan(0);
      }
      for (const link of r.links) {
        expect(link.labelEn.length).toBeGreaterThan(0);
        expect(link.labelZh.length).toBeGreaterThan(0);
        expect(link.noteEn.length).toBeGreaterThan(0);
        expect(link.noteZh.length).toBeGreaterThan(0);
      }
    }
  });

  it('links only to well-formed https URLs', () => {
    for (const r of sections) {
      const urls = [r.orgUrl, r.orgUrlZh];
      for (const theme of r.themes) urls.push(theme.url, theme.urlZh ?? theme.url);
      for (const link of r.links) urls.push(link.url, link.urlZh ?? link.url);
      for (const url of urls) {
        expect(url.startsWith('https://'), url).toBe(true);
        expect(() => new URL(url), url).not.toThrow();
      }
    }
  });
});

describe('getTopicResources', () => {
  it('resolves the work topic and rejects everything else', () => {
    expect(getTopicResources('work')?.orgNameEn).toBe('Called To Work');
    expect(getTopicResources('anxiety')).toBeNull();
    expect(getTopicResources('does-not-exist')).toBeNull();
  });
});

describe('linkHref', () => {
  it('uses the Chinese URL for Chinese readers when one exists', () => {
    expect(linkHref({ url: 'https://a.test/en', urlZh: 'https://a.test/zh' }, 'zh'))
      .toBe('https://a.test/zh');
  });

  it('falls back to the default URL for English readers or missing translations', () => {
    expect(linkHref({ url: 'https://a.test/en', urlZh: 'https://a.test/zh' }, 'en'))
      .toBe('https://a.test/en');
    expect(linkHref({ url: 'https://a.test/en' }, 'zh')).toBe('https://a.test/en');
  });
});
