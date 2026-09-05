// src/pages/api/tts.ts
// Text-to-speech endpoint backed by the open-source MeloTTS model on
// Workers AI. POST { text, lang } -> audio/mpeg.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { resolveTtsLang, sanitizeTtsText, synthesizeSpeech } from '../../lib/tts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const json = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const text = sanitizeTtsText(raw.text);
  if (!text) return json({ error: 'missing_text' }, 400);
  const lang = resolveTtsLang(raw.lang);

  try {
    const audio = await synthesizeSpeech(env.AI, text, lang);
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('tts synthesis failed', err);
    return json({ error: 'synthesis_failed' }, 502);
  }
};
