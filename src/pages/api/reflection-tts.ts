// src/pages/api/reflection-tts.ts
// Reads the model's reply for one of the reader's writing steps aloud, via the
// open-source MeloTTS model on Workers AI. POST { day, step } -> audio/mpeg.
//
// The reply is per-reader and written after they arrive, so it can never be
// prebuilt like the passage audio. The text is also never taken from the
// request: this endpoint speaks only what is already stored in D1 for this
// reader's day and step, which keeps the "synthesis never accepts arbitrary
// text" rule that bounds the cost of the free tier.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isStep, WRITING_STEPS } from '../../lib/dailySteps';
import { getStepEntries, getSession } from '../../lib/dailySession';
import { verifySessionToken } from '../../lib/session';
import { resolveTtsLang, sanitizeTtsText, synthesizeSpeech } from '../../lib/tts';

export const prerender = false;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function sessionToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'session') return rest.join('=');
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const token = sessionToken(request.headers.get('cookie') ?? '');
  const userId = token ? await verifySessionToken(token, env.SESSION_SECRET) : null;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let body: { day?: unknown; step?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const day = typeof body.day === 'string' ? body.day : '';
  const step = typeof body.step === 'string' ? body.step : '';
  if (!DAY_RE.test(day) || !isStep(step) || !(WRITING_STEPS as readonly string[]).includes(step)) {
    return json({ error: 'bad_request' }, 400);
  }

  // The reply is stored against the session's pinned language, not the
  // request's, so the voice always matches the words on screen.
  const session = await getSession(userId, day);
  if (!session) return json({ error: 'no_session' }, 404);
  const lang = resolveTtsLang(session.lang);

  const entry = (await getStepEntries(userId, day)).find((e) => e.step === step);
  const text = sanitizeTtsText(entry?.aiText);
  if (!text) return json({ error: 'no_reply' }, 404);

  let audio: Uint8Array;
  try {
    audio = await synthesizeSpeech(env.AI, text, lang);
  } catch (err) {
    console.error('reflection tts synthesis failed', err);
    return json({ error: 'synthesis_failed' }, 502);
  }

  // Per-reader content: never put this in a shared cache.
  return new Response(new Uint8Array(audio), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' },
  });
};
