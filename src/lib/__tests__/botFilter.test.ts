import { describe, expect, it } from 'vitest';
import { isLikelyBotUa, looksLikeBot } from '../botFilter';

describe('looksLikeBot', () => {
  it('recognizes common crawlers and unfurlers', () => {
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'HeadlessChrome/120.0.0.0',
      'python-requests/2.31.0',
      'curl/8.4.0',
      'facebookexternalhit/1.1',
      'Slackbot-LinkExpanding 1.0',
      'Datadog Agent/7.0 (uptime check)',
    ];
    for (const ua of bots) expect(looksLikeBot(ua)).toBe(true);
  });

  it('accepts real browsers', () => {
    const humans = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      // "Lighthouse" or "bot" must not match inside ordinary words.
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    ];
    for (const ua of humans) expect(looksLikeBot(ua)).toBe(false);
  });

  it('treats a missing UA as unknown, not bot', () => {
    expect(looksLikeBot(null)).toBe(false);
    expect(looksLikeBot('')).toBe(false);
  });
});

describe('isLikelyBotUa', () => {
  it('also withholds a missing UA', () => {
    expect(isLikelyBotUa(null)).toBe(true);
    expect(isLikelyBotUa('')).toBe(true);
    expect(isLikelyBotUa('curl/8.4.0')).toBe(true);
    expect(isLikelyBotUa('Mozilla/5.0 (Macintosh) Chrome/126.0')).toBe(false);
  });
});
