// Crawler detection for the analytics and session write paths.
//
// Server-side writes (a `daily_sessions` row per /today visit, an
// `analytics_events` row per beacon) cannot tell a reader from a crawler by
// themselves — every cookie-less request looks like a new guest. September's
// data showed crawlers outnumbering readers roughly ten to one there, which
// made every funnel metric meaningless. A User-Agent check is not
// sophisticated, but crawlers overwhelmingly announce themselves, and the
// cost of letting one through is one junk row, while the cost of a false
// positive is one reader whose quiet visit goes uncounted.

const BOT_UA_PATTERNS: RegExp[] = [
  /bot/i, // Googlebot, GPTBot, Bingbot, firecrawl-bot, ...
  /crawl/i,
  /spider/i,
  /slurp/i,
  /headless/i, // HeadlessChrome and friends
  /phantomjs/i,
  /lighthouse/i,
  /pagespeed/i,
  /petalbot/i,
  /yandex/i,
  /duckduck/i,
  /facebookexternalhit/i,
  /whatsapp/i,
  /slack/i, // link unfurlers
  /twitterbot/i,
  /linkedin/i,
  /embedly/i,
  /quora/i,
  /monitor/i, // uptime and performance monitors
  /pingdom/i,
  /datadog/i,
  /scrapy/i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /java\//i,
  /okhttp/i,
  /curl/i,
  /wget/i,
  /libwww/i,
  /httpclient/i,
  /node-fetch/i,
  /undici/i,
  /axios/i,
  /postman/i,
];

/**
 * True when the User-Agent belongs to a known crawler, unfurler, monitor, or
 * scripting client. A missing or empty UA is NOT a bot here — callers decide
 * whether anonymity itself disqualifies a request (see `isLikelyBotUa`).
 */
export function looksLikeBot(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

/**
 * Strict form for write paths that only make sense for a real browser:
 * a missing User-Agent is treated as a bot along with anything that
 * matches. Every browser sends a UA, so this only withholds rows from
 * anonymous scripts.
 */
export function isLikelyBotUa(ua: string | null | undefined): boolean {
  return !ua || looksLikeBot(ua);
}
