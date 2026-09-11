// Integration with the Daily Lectio Divina podcast by Abiding Way Ministries
// (Sharon Garlough Brown, https://www.abidingway.life/lectio-podcast),
// featured in the verse library by written permission of the publisher.
//
// Episodes are parsed from the publisher's public RSS feed and streamed
// straight from their own audio URLs — nothing is copied or re-hosted. The
// feed is fetched at most once per hour per edge colo (Cache API); on any
// failure the podcast sections simply render nothing.

export const PODCAST_FEED_URL =
  'https://www.abidingway.life/lectio-podcast?format=rss';
export const PODCAST_PAGE_URL = 'https://www.abidingway.life/lectio-podcast';

/** Publisher credit, per language. */
export const PODCAST_ATTRIBUTION = {
  en: 'Daily Lectio Divina podcast · Abiding Way Ministries (Sharon Garlough Brown)',
  zh: '《每日圣言诵读》播客 · Abiding Way Ministries（Sharon Garlough Brown）',
} as const;

export interface PodcastEpisode {
  /** Episode title, e.g. "Friday, September 11, 2026". */
  title: string;
  /** The passage the episode reads, e.g. "Matthew 18:21-27". */
  passage: string;
  /** Publisher-hosted audio URL (streamed, never copied). */
  audioUrl: string;
  /** Publisher's duration string, e.g. "15:17". */
  duration: string;
  /** Episode page on abidingway.life. */
  pageUrl: string;
}

export interface PassageRef {
  book: string;
  chapter: number;
  verseFrom: number;
  verseTo: number;
}

function unescapeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** First scripture reference in a string, e.g. "Matthew 18:21-27, Music …" */
export function extractPassage(text: string): string | null {
  const m = text.match(
    /\b((?:[1-3]\s?)?[A-Z][A-Za-z]*(?:\s+of\s+[A-Za-z]+)?\s+\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?)/,
  );
  return m ? m[1] : null;
}

/** "Matthew 18:21-27" → { book: 'matthew', chapter: 18, verseFrom: 21, verseTo: 27 }. */
export function parsePassageRef(passage: string): PassageRef | null {
  const m = passage
    .trim()
    .match(
      /^((?:[1-3]\s?)?[A-Za-z][A-Za-z\s.]*?)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/,
    );
  if (!m) return null;
  const book = m[1].replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const verseFrom = parseInt(m[3], 10);
  const verseTo = m[4] ? parseInt(m[4], 10) : verseFrom;
  if (!book || verseTo < verseFrom) return null;
  return { book, chapter: parseInt(m[2], 10), verseFrom, verseTo };
}

export function parseFeed(xml: string): PodcastEpisode[] {
  const episodes: PodcastEpisode[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const item of items) {
    const audioUrl = item.match(/<enclosure[^>]*url="([^"]+)"/)?.[1];
    const rawDesc =
      item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ??
      item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ??
      '';
    const passage = extractPassage(unescapeEntities(rawDesc)) ?? '';
    if (!audioUrl || !passage) continue;
    episodes.push({
      title: unescapeEntities(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      passage,
      audioUrl,
      duration: item.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/)?.[1] ?? '',
      pageUrl: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? PODCAST_PAGE_URL,
      });
  }
  return episodes;
}

/** Does an episode's passage cover the given verse reference? Book and
 * chapter must match; verse ranges must overlap. */
export function matchesVerseRef(episode: PodcastEpisode, verseRef: string): boolean {
  const a = parsePassageRef(episode.passage);
  const b = parsePassageRef(verseRef);
  if (!a || !b) return false;
  return (
    a.book === b.book &&
    a.chapter === b.chapter &&
    a.verseFrom <= b.verseTo &&
    b.verseFrom <= a.verseTo
  );
}

export function episodesForVerse(
  episodes: PodcastEpisode[],
  verseRef: string,
): PodcastEpisode[] {
  return episodes.filter((e) => matchesVerseRef(e, verseRef));
}

interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

function edgeCache(): CacheLike | undefined {
  return (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
}

/** Latest episodes from the publisher's feed, edge-cached for an hour.
 * Returns [] on any failure — callers render no podcast section. */
export async function getPodcastEpisodes(limit = 100): Promise<PodcastEpisode[]> {
  const cache = edgeCache();
  const cacheReq = new Request(PODCAST_FEED_URL);
  try {
    let xml: string | undefined;
    const hit = cache ? await cache.match(cacheReq) : undefined;
    if (hit) {
      xml = await hit.text();
    } else {
      const res = await fetch(PODCAST_FEED_URL, {
        headers: { 'User-Agent': 'LectioApp/1.0 (+https://enjoyhim.org)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`feed responded ${res.status}`);
      xml = await res.text();
      if (cache) {
        await cache.put(
          cacheReq,
          new Response(xml, { headers: { 'Cache-Control': 'public, max-age=3600' } }),
        );
      }
    }
    if (!xml) return [];
    return parseFeed(xml).slice(0, limit);
  } catch {
    return [];
  }
}
