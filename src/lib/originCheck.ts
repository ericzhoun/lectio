// Astro's built-in `security.checkOrigin` CSRF guard is an all-or-nothing
// switch: it runs ahead of our own middleware (astro/dist/core/middleware/load.js
// unshifts it before onRequest) and has no per-route escape hatch in this
// Astro version (7.2.8) - the only knob is the global config flag. Turning
// that flag off to let /unsubscribe accept a same-origin-less POST would
// silently drop CSRF protection from every other on-demand POST route too,
// including the auth endpoints under src/pages/api/auth/. So instead we turn
// the built-in guard off in astro.config.mjs and reimplement the identical
// check here, in user middleware that runs for every route, with one
// deliberate exemption: /unsubscribe.
//
// That exemption is safe specifically because /unsubscribe is not
// session-authenticated - it is authenticated by the HMAC token in the URL
// (see mailToken.ts). A forged cross-site POST without that token cannot
// unsubscribe anyone; Origin was never doing any work for this route that the
// token doesn't already do. Every other route below keeps exactly the
// behavior Astro's own middleware gave it.
//
// Logic mirrors astro/dist/core/app/origin-check.js verbatim so the site-wide
// protection does not change shape, just its location.
const FORM_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Paths that authenticate the request some other way (a signed token in the
// query string, here) and so do not need the Origin check. Keep this list
// short and each entry justified - it is the only thing standing between
// "reimplemented Astro's CSRF guard" and "quietly disabled it everywhere."
const ORIGIN_CHECK_EXEMPT_PATHS = new Set(['/unsubscribe']);

function hasFormLikeHeader(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return FORM_CONTENT_TYPES.some((type) => lower.includes(type));
}

export function isForbiddenCrossOriginRequest(
  request: Request,
  url: URL,
  isPrerendered: boolean
): boolean {
  if (isPrerendered) return false;
  if (SAFE_METHODS.includes(request.method)) return false;
  if (ORIGIN_CHECK_EXEMPT_PATHS.has(url.pathname)) return false;

  const isSameOrigin = request.headers.get('origin') === url.origin;
  const contentType = request.headers.get('content-type');
  if (contentType !== null) {
    return hasFormLikeHeader(contentType) && !isSameOrigin;
  }
  return !isSameOrigin;
}

export function crossOriginForbiddenResponse(request: Request): Response {
  return new Response(`Cross-site ${request.method} form submissions are forbidden`, {
    status: 403,
  });
}
