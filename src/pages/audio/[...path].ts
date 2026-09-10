// Serves prebuilt TTS clips straight from R2, keyed as
// "steps/<lang>/<name>.mp3" and "days/<lang>/<day>.mp3" — the site path minus
// the leading "audio/". Only keys listed in the manifests are reachable;
// anything else 404s, so this route can never read an arbitrary bucket
// object. Because the clips live in R2, a deploy no longer needs the audio
// corpus on the build machine — scripts/seed-audio-r2.mjs keeps the bucket in
// sync with the manifests, and check-build-output.mjs gates deploys on it.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { audioR2Key } from '../../lib/audio';
import { serveR2Audio } from '../../lib/r2Audio';

export const prerender = false;

/** A clip's bytes never change once generated: the browser caches for a day
 * and the edge for a month, matching the old static-asset headers. */
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=2592000';

export const GET: APIRoute = async ({ params, request }) => {
  const key = audioR2Key(`/audio/${params.path ?? ''}`);
  if (!key) return new Response(null, { status: 404 });
  return serveR2Audio(env.AUDIO, key, request, CACHE_CONTROL);
};

// Astro does not route HEAD to GET; the runtime drops the body on its own.
export const HEAD = GET;
