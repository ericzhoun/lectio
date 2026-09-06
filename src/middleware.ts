// Assigns every visitor a stable first-party id and their A/B variants
// before any page renders, so experiments are flicker-free and every route
// (pages and APIs) shares the same visitor identity.
import { defineMiddleware } from 'astro:middleware';
import { assignVariants, serializeVariantCookie } from './lib/ab';

const TWO_YEARS = 60 * 60 * 24 * 365 * 2;

export const onRequest = defineMiddleware((context, next) => {
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
  return next();
});
