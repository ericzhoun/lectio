// Integration with the Daily Lectio Divina podcast by Abiding Way Ministries
// (Sharon Garlough Brown, https://www.abidingway.life/lectio-podcast),
// featured in the verse library by written permission of the publisher.
//
// Episodes are parsed from the publisher's public RSS feed and streamed
// straight from their own audio URLs — nothing is copied or re-hosted. The
// feed itself is fetched once an hour by the cron Worker (refreshPodcastFeed)
// into KV, so page renders read KV and never touch the network. The edge
// Cache API (12-hour TTL) is only a fallback for when KV is empty, and a
// failed fetch is negatively cached for 10 minutes so an upstream outage
// cannot turn every page render into a fresh fetch. On any failure the
// podcast sections simply render nothing.

import { env } from 'cloudflare:workers';

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

interface KvLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function edgeCache(): CacheLike | undefined {
  return (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
}

function podcastKv(): KvLike | undefined {
  return env.PODCAST_KV;
}

/** Key under which the parsed episode list is stored in KV. Bump the suffix
 * if the PodcastEpisode shape ever changes. */
const PODCAST_KV_KEY = 'podcast:episodes:v1';
/** Edge-cache TTL for a directly fetched feed — the daily podcast never
 * changes within half a day. */
const FEED_CACHE_TTL = 60 * 60 * 12;
/** How long a failed fetch is remembered, so upstream slowness doesn't turn
 * every page render into another 8-second fetch attempt. */
const FEED_NEGATIVE_TTL = 600;
/** KV entry TTL — comfortably beyond the cron's hourly refresh. */
const FEED_KV_TTL = 60 * 60 * 26;

/** Request init for the publisher's feed. Built per call: an AbortSignal
 * may not be created in a Worker's global scope, only inside a handler. */
function feedFetchInit(): RequestInit {
  return {
    headers: { 'User-Agent': 'LectioApp/1.0 (+https://enjoyhim.org)' },
    signal: AbortSignal.timeout(8000),
  };
}

function feedToKvValue(episodes: PodcastEpisode[]): string {
  return JSON.stringify({ episodes });
}

/** Hourly cron-side refresh: fetch the publisher's feed once for the whole
 * account (not once per edge colo) and store the parsed episodes in KV, so
 * page renders never have to fetch. Returns true when a fresh feed was
 * stored; skips the write when the feed is unchanged. */
export async function refreshPodcastFeed(kv: KvLike | undefined): Promise<boolean> {
  if (!kv) return false;
  try {
    const res = await fetch(PODCAST_FEED_URL, feedFetchInit());
    if (!res.ok) throw new Error(`feed responded ${res.status}`);
    const xml = await res.text();
    const episodes = parseFeed(xml).slice(0, 100);
    if (!episodes.length) throw new Error('feed parsed to no episodes');
    const value = feedToKvValue(episodes);
    const current = await kv.get(PODCAST_KV_KEY, 'json');
    if (JSON.stringify(current) === value) return false;
    await kv.put(PODCAST_KV_KEY, value, { expirationTtl: FEED_KV_TTL });
    return true;
  } catch (e) {
    console.error('podcast: refresh failed:', e);
    return false;
  }
}

/** Best-effort KV repopulation when the request path had to fetch itself. */
async function repopulateKv(kv: KvLike | undefined, episodes: PodcastEpisode[]): Promise<void> {
  if (!kv || !episodes.length) return;
  try {
    await kv.put(PODCAST_KV_KEY, feedToKvValue(episodes), { expirationTtl: FEED_KV_TTL });
  } catch {
    // KV hiccups must not fail the render.
  }
}

/** Latest episodes from the publisher's feed. Reads KV (refreshed hourly by
 * the cron Worker); falls back to the 12-hour edge cache and a direct fetch,
 * and negatively caches failures for 10 minutes. Returns [] on any failure —
 * callers render no podcast section. */
export async function getPodcastEpisodes(limit = 100): Promise<PodcastEpisode[]> {
  const kv = podcastKv();
  try {
    const stored = kv ? await kv.get(PODCAST_KV_KEY, 'json') : undefined;
    if (stored && Array.isArray((stored as { episodes?: unknown }).episodes)) {
      return (stored as { episodes: PodcastEpisode[] }).episodes.slice(0, limit);
    }
  } catch {
    // KV unavailable — fall through to the edge cache.
  }

  const cache = edgeCache();
  const cacheReq = new Request(PODCAST_FEED_URL);
  let xml: string | undefined;
  try {
    const hit = cache ? await cache.match(cacheReq) : undefined;
    if (hit) {
      xml = await hit.text();
      // An empty body is a negative entry from a recent failed fetch.
      if (xml === '') return [];
    } else {
      const res = await fetch(PODCAST_FEED_URL, feedFetchInit());
      if (!res.ok) throw new Error(`feed responded ${res.status}`);
      xml = await res.text();
      if (cache) {
        await cache.put(
          cacheReq,
          new Response(xml, { headers: { 'Cache-Control': `public, max-age=${FEED_CACHE_TTL}` } }),
        );
      }
    }
  } catch {
    // Upstream (or edge cache) failure: remember it briefly so the next
    // renders don't each retry the fetch.
    if (cache) {
      try {
        await cache.put(
          cacheReq,
          new Response('', {
            headers: { 'Cache-Control': `public, max-age=${FEED_NEGATIVE_TTL}` },
          }),
        );
      } catch {
        // Cache API unavailable — nothing more to do.
      }
    }
    return [];
  }
  if (!xml) return [];
  const episodes = parseFeed(xml);
  await repopulateKv(kv, episodes);
  return episodes.slice(0, limit);
}
