// Serves pre-cut passage music from R2, keyed as "music/singing-bible/<name>.mp3"
// - the site path minus the leading "/". The clips are generated locally
// (npm run music:prepare) and gitignored, so a git-triggered build never has
// them in dist/client; scripts/seed-audio-r2.mjs uploads them to the bucket.
// Only manifest-listed keys are reachable; anything else 404s.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { musicR2Key } from '../../lib/audio';
import { serveR2Audio } from '../../lib/r2Audio';

export const prerender = false;

/** Filenames carry their source/timing hash, so the bytes never change. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const GET: APIRoute = async ({ params, request }) => {
  const key = musicR2Key(`/music/${params.path ?? ''}`);
  if (!key) return new Response(null, { status: 404 });
  return serveR2Audio(env.AUDIO, key, request, CACHE_CONTROL);
};
