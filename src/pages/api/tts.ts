// src/pages/api/tts.ts
// Reads the day's lectionary passage aloud. GET /api/tts?day=YYYY-MM-DD&lang=en
// -> audio. English is synthesized on Workers AI, Chinese on OpenAI (see
// src/lib/tts.ts for why), and both lose to a prebuilt clip when one exists.
//
// The caller names a day, never the text: synthesis costs money, so the set of
// things this endpoint will ever say is the lectionary table and nothing else.
// That also makes every response cacheable, and the same passage is read by
// every reader of that day - so each one is synthesized once, globally.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { audioR2Key, hasPrebuiltDayAudio, prebuiltDayAudioUrl, stepAudioUrl } from '../../lib/audio';
import { isStep, STEP_COPY } from '../../lib/dailySteps';
import { focusReference, getLectionaryDay, hasLectionaryDay } from '../../lib/lectionary';
import { resolvePassage } from '../../lib/passage';
import { resolveTtsLang, sanitizeTtsText, synthesizeSpeech, type TtsAudio } from '../../lib/tts';

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
  const step = url.searchParams.get('step');
  if (step !== null && !isStep(step)) return json({ error: 'unknown_step' }, 404);
  if (step === null && (!DAY_RE.test(day) || !hasLectionaryDay(day))) return json({ error: 'unknown_day' }, 404);
  const lang = resolveTtsLang(url.searchParams.get('lang'));

  const text = sanitizeTtsText(isStep(step)
    ? STEP_COPY[step].prompt[lang]
    : resolvePassage(focusReference(getLectionaryDay(day)), lang)?.text);
  if (!text) return json({ error: 'no_passage' }, 404);

  // A prebuilt Chatterbox clip beats on-demand synthesis whenever it exists:
  // better voice, zero per-request cost. Days without one still get MeloTTS.
  const prebuilt = isStep(step) ? stepAudioUrl(lang, step)
    : hasPrebuiltDayAudio(day, lang) ? prebuiltDayAudioUrl(lang, day) : null;
  if (prebuilt) {
    // Prebuilt clips live in R2 (bucket lectio-audio), not in the deploy's
    // static assets. A miss falls through to on-demand synthesis, exactly
    // like the old ASSETS lookup missing a file.
    const key = audioR2Key(prebuilt);
    const object = key ? await env.AUDIO.get(key) : null;
    if (object) {
      // R2's stream is typed by workers-types; Response here is the DOM one.
      return new Response(object.body as unknown as ReadableStream, {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': CACHE_CONTROL },
      });
    }
  }

  // Normalized so 'lang=fr' and a missing lang share the 'en' entry.
  const cacheKey = new Request(new URL(`/api/tts?${step === null ? `day=${day}` : `step=${step}`}&lang=${lang}`, url).toString());
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  let audio: TtsAudio;
  try {
    audio = await synthesizeSpeech(env.AI, text, lang);
  } catch (err) {
    console.error('tts synthesis failed', err);
    return json({ error: 'synthesis_failed' }, 502);
  }

  // The media type comes from the synthesizer, not from a guess: MeloTTS
  // answers in WAV despite its schema, and the OpenAI voice used for Chinese
  // answers in MP3.
  const response = new Response(new Uint8Array(audio.bytes), {
    status: 200,
    headers: { 'Content-Type': audio.contentType, 'Cache-Control': CACHE_CONTROL },
  });
  await cache?.put(cacheKey, response.clone());
  return response;
};
