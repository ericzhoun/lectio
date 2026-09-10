import { describe, expect, it } from 'vitest';
import { renderDailyEmail, unsubscribeUrl, truncate } from '../dailyEmail';

const LINK = 'https://enjoyhim.org/unsubscribe?e=reader%40example.test&t=abc';

describe('unsubscribeUrl', () => {
  it('escapes the address so a plus-addressed reader still unsubscribes', () => {
    const url = unsubscribeUrl('reader+daily@example.test', 'tok', 'en');
    expect(url).toBe('https://enjoyhim.org/unsubscribe?e=reader%2Bdaily%40example.test&t=tok');
  });

  it('carries &lang=zh for a Chinese reader so the click lands on Chinese copy', () => {
    const url = unsubscribeUrl('reader@example.test', 'tok', 'zh');
    expect(url).toContain('&lang=zh');
  });

  it('omits lang for an English reader', () => {
    const url = unsubscribeUrl('reader@example.test', 'tok', 'en');
    expect(url).not.toContain('lang=');
  });
});

describe('renderDailyEmail', () => {
  it('renders an English morning with the day title, passage and a link to today', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK, 'America/Los_Angeles');
    expect(mail).not.toBeNull();
    expect(mail!.subject.length).toBeGreaterThan(0);
    expect(mail!.html).toContain('https://enjoyhim.org/today');
    // The href attribute must have the link HTML-escaped.
    const linkEscaped = LINK.replace(/&/g, '&amp;');
    expect(mail!.html).toContain(`href="${linkEscaped}"`);
    // The plain text must carry the raw, unescaped URL.
    expect(mail!.text).toContain(LINK);
    // The passage itself must be in the email, not only behind the link.
    expect(mail!.text.length).toBeGreaterThan(120);
  });

  it('renders Chinese copy and a Chinese reference for zh readers', () => {
    const mail = renderDailyEmail('2026-09-09', 'zh', LINK, 'Asia/Shanghai');
    expect(mail).not.toBeNull();
    expect(mail!.html).toMatch(/[一-鿿]/);
    expect(mail!.text).toMatch(/[一-鿿]/);
  });

  it('escapes the passage into HTML so scripture punctuation cannot break the markup', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK, 'America/Los_Angeles');
    expect(mail!.html).not.toMatch(/<script/i);
    expect(mail!.html).toContain('<!doctype html>');
  });

  it('truncates a long passage rather than pasting a whole chapter into an inbox', () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK, 'America/Los_Angeles');
    const body = mail!.text;
    expect(body.length).toBeLessThan(2000);
  });

  it('returns null for a day whose passage cannot be resolved', () => {
    // Far outside the generated lectionary window and the bundled chapters.
    expect(renderDailyEmail('not-a-day', 'en', LINK, 'America/Los_Angeles')).toBeNull();
  });

  it('uses Chinese full-width ellipsis when truncating zh passages', () => {
    // Create a passage longer than MAX_PASSAGE_CHARS
    const longPassage = 'This is a test passage. '.repeat(50);
    const { body, truncated } = truncate(longPassage, 'zh');
    expect(truncated).toBe(true);
    expect(body).toMatch(/……$/);
    expect(body).not.toMatch(/\.\.\.$/);
  });

  it('uses ASCII ellipsis when truncating en passages', () => {
    const longPassage = 'This is a test passage. '.repeat(50);
    const { body, truncated } = truncate(longPassage, 'en');
    expect(truncated).toBe(true);
    expect(body).toMatch(/\.\.\.$/);
    expect(body).not.toMatch(/……$/);
  });

  it('includes a head with a charset meta so Chinese text does not mojibake', () => {
    const mail = renderDailyEmail('2026-09-09', 'zh', LINK, 'Asia/Shanghai');
    expect(mail!.html).toContain('<head>');
    expect(mail!.html).toContain('charset="utf-8"');
    expect(mail!.html).toContain('viewport');
  });

  it("links to today with the reader's own zone, so a click resolves the same day the email printed", () => {
    const mail = renderDailyEmail('2026-09-09', 'en', LINK, 'Asia/Shanghai');
    expect(mail!.html).toContain(`tz=${encodeURIComponent('Asia/Shanghai')}`);
    expect(mail!.text).toContain(`tz=${encodeURIComponent('Asia/Shanghai')}`);
  });
});
