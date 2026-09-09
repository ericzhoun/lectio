// Assigns every visitor a stable first-party id and their A/B variants
// before any page renders, so experiments are flicker-free and every route
// (pages and APIs) shares the same visitor identity.
import { defineMiddleware } from 'astro:middleware';
import { assignVariants, serializeVariantCookie } from './lib/ab';
import { crossOriginForbiddenResponse, isForbiddenCrossOriginRequest } from './lib/originCheck';

const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

// Every HTML response is personalized from cookies (lang, session, A/B
// variants), and redirects like /today -> /today/<step> depend on per-reader
// session state, so neither may be shared-cached. The origin used to send no
// Cache-Control at all, letting a zone cache rule serve cached /today/* HTML
// in the wrong language. Routes that opt into caching themselves (e.g.
// content-addressed /audio/*, /api/tts) already set their own header and are
// left untouched.
function noStore(response: Response): Response {
  if (response.headers.has('Cache-Control')) return response;
  const contentType = response.headers.get('Content-Type') ?? '';
  const isHtml = contentType.includes('text/html');
  const isRedirect = response.status >= 300 && response.status < 400;
  if (!isHtml && !isRedirect) return response;
  // Rebuild rather than mutate: redirect responses (Response.redirect,
  // Astro.redirect) carry immutable headers.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Astro's own CSRF guard is disabled globally (astro.config.mjs) because it
  // has no per-route exemption; this reimplements it for every route except
  // /unsubscribe, which authenticates by URL token instead of same-origin
  // POSTs. See lib/originCheck.ts for why that one exemption is safe.
  if (isForbiddenCrossOriginRequest(context.request, context.url, context.isPrerendered)) {
    return crossOriginForbiddenResponse(context.request);
  }

  // Normalize trailing slashes: /library/ and /library must not both serve 200
  // with their own self-canonical tag. Redirect once (308 preserves the method)
  // and leave API routes untouched.
  const pathname = context.url.pathname;
  const stripped = pathname.replace(/\/+$/, '');
  if (stripped && stripped !== pathname && !pathname.startsWith('/api/')) {
    return noStore(new Response(null, {
      status: 308,
      headers: { Location: `${stripped}${context.url.search}` },
    }));
  }

  const cookies = context.cookies;
  let vid = cookies.get('vid')?.value;
  if (!vid || !/^[0-9a-f-]{36}$/.test(vid)) {
    vid = crypto.randomUUID();
    cookies.set('vid', vid, {
      path: '/',
      httpOnly: false, // The page script sends it with each event batch.
      sameSite: 'lax',
      secure: true,
      maxAge: TWO_YEARS,
    });
  }

  // Assignment is deterministic from the visitor id, so the cookie is just a
  // cache the client script reads to stamp events with their variants.
  const variants = assignVariants(vid);
  const cookieValue = cookies.get('ab')?.value;
  const serialized = serializeVariantCookie(variants);
  if (cookieValue !== serialized) {
    cookies.set('ab', serialized, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      maxAge: TWO_YEARS,
    });
  }

  context.locals.vid = vid;
  context.locals.variants = variants;
  return noStore(await next());
});
