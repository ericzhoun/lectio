// src/pages/api/assistant/chat.ts
// Streaming chat endpoint for the site assistant.
// Quota first, stream second; quota is charged on the first delivered chunk.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  HISTORY_TURNS_SENT,
  buildSystemPrompt,
  buildGroundingFacts,
  evaluateChatQuota,
  streamAssistantReply,
  type ChatTurn,
  type PageContext,
} from '../../../lib/assistant';
import { getChatUsage, incrementChatUsage } from '../../../lib/chatUsage';
import { verifySessionToken } from '../../../lib/session';
import { resolveTier } from '../../../lib/entitlements';

export const prerender = false;

const ANON_COOKIE = 'chat_anon';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const MESSAGE_MAX_CHARS = 2000;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sanitizeMessage(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MESSAGE_MAX_CHARS) : '';
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const role = (t as Record<string, unknown>).role;
    const content = (t as Record<string, unknown>).content;
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content.trim()) {
      turns.push({ role, content: content.trim().slice(0, MESSAGE_MAX_CHARS) });
    }
  }
  return turns.slice(-HISTORY_TURNS_SENT);
}

function sanitizeContext(raw: unknown): PageContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const path = typeof c.path === 'string' ? c.path.slice(0, 300) : '';
  const title = typeof c.title === 'string' ? c.title.slice(0, 200) : '';
  let reading: PageContext['reading'] = null;
  const readingRaw = c.reading as Record<string, unknown> | null | undefined;
  if (readingRaw && typeof readingRaw === 'object') {
    const itemsRaw = Array.isArray(readingRaw.items) ? readingRaw.items.slice(0, 12) : [];
    reading = {
      spread: typeof readingRaw.spread === 'string' ? readingRaw.spread.slice(0, 100) : '',
      question: typeof readingRaw.question === 'string' ? readingRaw.question.slice(0, 500) : '',
      items: itemsRaw.map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return {
          name: typeof o.name === 'string' ? o.name.slice(0, 200) : '',
          position: typeof o.position === 'string' ? o.position.slice(0, 100) : '',
          interp: typeof o.interp === 'string' ? o.interp.slice(0, 1000) : '',
        };
      }),
    };
  }
  if (!path && !title) return null;
  return { path, title, reading };
}

function sanitizeLang(cookies: { get(name: string): { value: string } | undefined }): 'zh' | 'en' {
  return cookies.get('lang')?.value === 'zh' ? 'zh' : 'en';
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const message = sanitizeMessage(body.message);
  if (!message) return json({ error: 'empty_message' }, 400);

  // Resolve the visitor: registered user, else anonymous cookie (created on
  // the first message - page renders never set cookies).
  const sessionCookie = cookies.get('session')?.value;
  const userId = sessionCookie ? await verifySessionToken(sessionCookie, env.SESSION_SECRET) : null;

  let visitorKey: string;
  let registered: boolean;
  let tier: 'free' | 'basic' | 'pro' = 'free';
  if (userId) {
    registered = true;
    tier = await resolveTier(userId);
    visitorKey = `u:${userId}`;
  } else {
    registered = false;
    const existing = cookies.get(ANON_COOKIE)?.value;
    // Accept any a:-namespaced key (the cookie is httpOnly and self-issued);
    // the prefix check keeps forged cookies out of registered users' u: buckets.
    if (existing && /^a:[A-Za-z0-9-]{1,64}$/.test(existing)) {
      visitorKey = existing;
    } else {
      visitorKey = `a:${crypto.randomUUID()}`;
      cookies.set(ANON_COOKIE, visitorKey, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: ANON_COOKIE_MAX_AGE,
      });
    }
  }

  const used = await getChatUsage(visitorKey, env.DB);
  const quota = evaluateChatQuota({ registered, tier }, used);
  if (!quota.ok) {
    return json({ error: 'quota_exceeded', registered, tier, remaining: 0 }, 429);
  }

  const system = buildSystemPrompt({
    lang: sanitizeLang(cookies),
    context: sanitizeContext(body.context),
    grounding: buildGroundingFacts(),
  });
  const history = sanitizeHistory(body.history);

  let stream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>;
  try {
    stream = await streamAssistantReply([
      { role: 'system', content: system },
      ...history.map((t) => ({ role: t.role, content: t.content }) as const),
      { role: 'user', content: message },
    ]);
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }

  const encoder = new TextEncoder();
  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Charge the quota when the first content chunk is delivered: a model
      // call that produces nothing stays free (502 / empty stream), but once
      // text reaches the visitor the generation is paid for even if the
      // client aborts or the upstream stream dies mid-way.
      let charged = false;
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            if (!charged) {
              // Consume one message from the daily quota.
              await incrementChatUsage(visitorKey, env.DB);
              charged = true;
            }
            controller.enqueue(encoder.encode(delta));
          }
        }
        controller.close();
      } catch (e) {
        // Mid-stream failure: deliver the partial reply; the client-side
        // retry affordance covers the truncated tail. Log it so upstream
        // failures are observable in production.
        console.error('assistant stream error:', e);
        controller.close();
      }
    },
  });
  return new Response(responseBody, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
