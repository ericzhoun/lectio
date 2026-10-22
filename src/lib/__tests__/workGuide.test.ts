import { describe, it, expect } from 'vitest';
import { WORK_GUIDE, guideRefs } from '../workGuide';
import { getLibraryVerseByRef, getLibraryVerseBySlug } from '../scripture';

const sections = WORK_GUIDE.sections;
const theses = WORK_GUIDE.theses;

describe('WORK_GUIDE', () => {
  it('has a slug that cannot collide with a deck verse route', () => {
    expect(WORK_GUIDE.slug).toMatch(/^[a-z0-9-]+$/);
    expect(getLibraryVerseBySlug(WORK_GUIDE.slug)).toBeNull();
  });

  it('has complete bilingual copy', () => {
    const scalars = [
      WORK_GUIDE.titleEn, WORK_GUIDE.titleZh,
      WORK_GUIDE.standfirstEn, WORK_GUIDE.standfirstZh,
      WORK_GUIDE.thesisHeadingEn, WORK_GUIDE.thesisHeadingZh,
      WORK_GUIDE.readingListHeadingEn, WORK_GUIDE.readingListHeadingZh,
    ];
    for (const field of scalars) expect(field.length).toBeGreaterThan(0);

    expect(WORK_GUIDE.closingEn.length).toBeGreaterThan(0);
    expect(WORK_GUIDE.closingZh.length).toBe(WORK_GUIDE.closingEn.length);

    for (const section of sections) {
      for (const field of [section.kickerEn, section.kickerZh, section.headingEn, section.headingZh]) {
        expect(field.length).toBeGreaterThan(0);
      }
      expect(section.paragraphsEn.length).toBeGreaterThan(0);
      expect(section.paragraphsZh.length).toBe(section.paragraphsEn.length);
      for (const p of [...section.paragraphsEn, ...section.paragraphsZh]) {
        expect(p.length).toBeGreaterThan(0);
      }
    }

    for (const thesis of theses) {
      for (const field of [thesis.titleEn, thesis.titleZh, thesis.bodyEn, thesis.bodyZh]) {
        expect(field.length).toBeGreaterThan(0);
      }
    }
  });

  it('cites only verses that exist in the deck', () => {
    for (const ref of guideRefs(WORK_GUIDE)) {
      expect(getLibraryVerseByRef(ref), ref).not.toBeNull();
    }
    // Every ref named in a section or thesis must be listed by guideRefs().
    const listed = new Set(guideRefs(WORK_GUIDE));
    for (const ref of [...sections.flatMap((s) => s.refs), ...theses.flatMap((t) => t.refs)]) {
      expect(listed.has(ref), ref).toBe(true);
    }
  });

  it('builds a deduplicated reading list in first-appearance order', () => {
    const refs = guideRefs(WORK_GUIDE);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.length).toBeGreaterThanOrEqual(10);
    // The first cited passage of the first citing section comes first.
    const firstCited = sections.find((s) => s.refs.length > 0)?.refs[0];
    if (firstCited) expect(refs[0]).toBe(firstCited);
  });

  it('ties the guide to an existing topic', () => {
    expect(WORK_GUIDE.topicSlug).toBe('work');
    expect(theses).toHaveLength(4);
  });
});
