import { describe, expect, it } from 'vitest';
import {
  extractPassage,
  episodesForVerse,
  matchesVerseRef,
  parseFeed,
  parsePassageRef,
} from '../podcast';

const FIXTURE = `<rss version="2.0"><channel><title>Daily Lectio Divina</title>
<item><title>Friday, September 11, 2026</title><dc:creator>Jack Brown</dc:creator>
<pubDate>Thu, 10 Sep 2026 23:49:43 +0000</pubDate>
<link>https://www.abidingway.life/lectio-podcast/episode-246</link>
<description><![CDATA[Matthew 18:21-27, Music licensed by Soundstripe.]]></description>
<itunes:duration>15:17</itunes:duration>
<enclosure url="https://cdn.example/9+11+2026+lectio.mp3" length="14747734" type="audio/mpeg"/></item>
<item><title>Thursday, September 10, 2026</title>
<link>https://www.abidingway.life/lectio-podcast/episode-245</link>
<description><![CDATA[Psalm 98:1-5, Music licensed by Soundstripe.]]></description>
<itunes:duration>12:03</itunes:duration>
<enclosure url="https://cdn.example/9+10+2026+lectio.mp3" length="12000000" type="audio/mpeg"/></item>
<item><title>Broken item</title><description><![CDATA[no reference here]]></description></item>
</channel></rss>`;

describe('extractPassage', () => {
  it('finds the first scripture reference', () => {
    expect(extractPassage('Matthew 18:21-27, Music licensed by Soundstripe.')).toBe(
      'Matthew 18:21-27',
    );
  });

  it('handles numbered books and single verses', () => {
    expect(extractPassage('1 Corinthians 13:4-5, Music.')).toBe('1 Corinthians 13:4-5');
    expect(extractPassage('John 3:16')).toBe('John 3:16');
  });

  it('returns null when no reference appears', () => {
    expect(extractPassage('no reference here')).toBeNull();
  });
});

describe('parsePassageRef', () => {
  it('parses verse ranges', () => {
    expect(parsePassageRef('Matthew 18:21-27')).toEqual({
      book: 'matthew',
      chapter: 18,
      verseFrom: 21,
      verseTo: 27,
    });
  });

  it('parses single verses and numbered books', () => {
    expect(parsePassageRef('John 3:16')).toEqual({
      book: 'john',
      chapter: 3,
      verseFrom: 16,
      verseTo: 16,
    });
    expect(parsePassageRef('1 Corinthians 13:4-5')?.book).toBe('1 corinthians');
  });

  it('rejects malformed references', () => {
    expect(parsePassageRef('not a ref')).toBeNull();
    expect(parsePassageRef('Matthew 18')).toBeNull();
    expect(parsePassageRef('Matthew 18:27-21')).toBeNull();
  });
});

describe('parseFeed', () => {
  const episodes = parseFeed(FIXTURE);

  it('parses complete items and skips ones without a reference', () => {
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toEqual({
      title: 'Friday, September 11, 2026',
      passage: 'Matthew 18:21-27',
      audioUrl: 'https://cdn.example/9+11+2026+lectio.mp3',
      duration: '15:17',
      pageUrl: 'https://www.abidingway.life/lectio-podcast/episode-246',
    });
  });

  it('keeps the publisher audio URL untouched', () => {
    expect(episodes[1].audioUrl).toBe('https://cdn.example/9+10+2026+lectio.mp3');
  });
});

describe('matchesVerseRef', () => {
  const episode: Parameters<typeof matchesVerseRef>[0] = {
    title: 't',
    passage: 'Matthew 18:21-27',
    audioUrl: 'a',
    duration: '15:17',
    pageUrl: 'p',
  };

  it('matches when the verse falls inside the episode range', () => {
    expect(matchesVerseRef(episode, 'Matthew 18:22')).toBe(true);
    expect(matchesVerseRef(episode, 'Matthew 18:21')).toBe(true);
    expect(matchesVerseRef(episode, 'Matthew 18:27')).toBe(true);
  });

  it('rejects different chapters, books, and disjoint verses', () => {
    expect(matchesVerseRef(episode, 'Matthew 19:1')).toBe(false);
    expect(matchesVerseRef(episode, 'Mark 18:22')).toBe(false);
    expect(matchesVerseRef(episode, 'Matthew 18:28')).toBe(false);
  });
});

describe('episodesForVerse', () => {
  it('filters episodes down to the ones covering a verse', () => {
    const episodes = parseFeed(FIXTURE);
    expect(episodesForVerse(episodes, 'Matthew 18:25')).toHaveLength(1);
    expect(episodesForVerse(episodes, 'Psalm 98:2')).toHaveLength(1);
    expect(episodesForVerse(episodes, 'John 3:16')).toHaveLength(0);
  });
});
