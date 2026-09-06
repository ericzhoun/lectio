// src/pages/api/tts.ts
// Reads the day's lectionary passage aloud, via the open-source MeloTTS model
// on Workers AI. GET /api/tts?day=YYYY-MM-DD&lang=en -> audio/mpeg.
//
// The caller names a day, never the text: synthesis costs money, so the set of
// things this endpoint will ever say is the lectionary table and nothing else.
// That also makes every response cacheable, and the same passage is read by
// every reader of that day - so each one is synthesized once, globally.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hasPrebuiltDayAudio, prebuiltDayAudioUrl } from '../../lib/audio';
import { focusReference, getLectionaryDay, hasLectionaryDay } from '../../lib/lectionary';
import { resolvePassage } from '../../lib/passage';
import { resolveTtsLang, sanitizeTtsText, synthesizeSpeech } from '../../lib/tts';

export const prerender = false;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A day's audio never changes once synthesized. */
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=2592000, immutable';

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ url }) => {
  const day = url.searchParams.get('day') ?? '';
  if (!DAY_RE.test(day) || !hasLectionaryDay(day)) return json({ error: 'unknown_day' }, 404);
  const lang = resolveTtsLang(url.searchParams.get('lang'));

  const passage = resolvePassage(focusReference(getLectionaryDay(day)), lang);
  const text = sanitizeTtsText(passage?.text);
  if (!text) return json({ error: 'no_passage' }, 404);

  // A prebuilt Chatterbox clip beats on-demand synthesis whenever it exists:
  // better voice, zero per-request cost. Days without one still get MeloTTS.
  if (hasPrebuiltDayAudio(day, lang)) {
    const asset = await env.ASSETS.fetch(
      new Request(new URL(prebuiltDayAudioUrl(lang, day), url.origin).toString())
    );
    if (asset.ok) {
      return new Response(asset.body, {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL },
      });
    }
  }

  // Normalized so 'lang=fr' and a missing lang share the 'en' entry.
  const cacheKey = new Request(new URL(`/api/tts?day=${day}&lang=${lang}`, url).toString());
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  let audio: Uint8Array;
  try {
    audio = await synthesizeSpeech(env.AI, text, lang);
  } catch (err) {
    console.error('tts synthesis failed', err);
    return json({ error: 'synthesis_failed' }, 502);
  }

  const response = new Response(new Uint8Array(audio), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL },
  });
  await cache?.put(cacheKey, response.clone());
  return response;
};
