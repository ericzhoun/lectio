import { describe, expect, it } from 'vitest';
import { renderDailyEmail, unsubscribeUrl } from '../dailyEmail';

const LINK = 'https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=abc';

describe('unsubscribeUrl', () => {
  it('escapes the address so a plus-addressed reader still unsubscribes', () => {
    const url = unsubscribeUrl('reader+daily@example.test', 'tok');
    expect(url).toBe('https://enjoyhim.org/unsubscribe?e=reader%2Bdaily%40example.test&t=tok');
  });
});

describe('renderDailyEmail', () => {
  it('renders an English morning with the day title, passage and a link to today', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    expect(mail).not.toBeNull();
    expect(mail!.subject.length).toBeGreaterThan(0);
    expect(mail!.html).toContain('https://enjoyhim.org/today');
    expect(mail!.html).toContain(LINK);
    expect(mail!.text).toContain(LINK);
    // The passage itself must be in the email, not only behind the link.
    expect(mail!.text.length).toBeGreaterThan(120);
  });

  it('renders Chinese copy and a Chinese reference for zh readers', () => {
    const mail = renderDailyEmail('2026-09-09', 'zh', LINK);
    expect(mail).not.toBeNull();
    expect(mail!.html).toMatch(/[一-鿿]/);
    expect(mail!.text).toMatch(/[一-鿿]/);
  });

  it('escapes the passage into HTML so scripture punctuation cannot break the markup', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    expect(mail!.html).not.toMatch(/<script/i);
    expect(mail!.html).toContain('<!doctype html>');
  });

  it('truncates a long passage rather than pasting a whole chapter into an inbox', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK);
    const body = mail!.text;
    expect(body.length).toBeLessThan(2000);
  });

  it('returns null for a day whose passage cannot be resolved', () => {
    // Far outside the generated lectionary window and the bundled chapters.
    expect(renderDailyEmail('not-a-day', 'en', LINK)).toBeNull();
  });
});
