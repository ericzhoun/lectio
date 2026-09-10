// src/pages/api/assistant/chat.ts
// Streaming chat endpoint for the site assistant.
// Quota first, stream second; quota is charged on the first delivered chunk.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  HISTORY_TURNS_SENT,
  buildSystemPrompt,
  buildGroundingFacts,
  callAssistantModel,
  evaluateChatQuota,
  streamAssistantReply,
  type ChatTurn,
  type PageContext,
} from '../../../lib/assistant';
import { runAssistantTurn } from '../../../lib/assistantLoop';
import type { ToolContext } from '../../../lib/assistantTools';
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

/** Tool arguments arrive as a model-written JSON string; anything else is no arguments. */
function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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

  const baseMessages = [
    { role: 'system' as const, content: system },
    ...history.map((t) => ({ role: t.role, content: t.content }) as const),
    { role: 'user' as const, content: message },
  ];

  const encoder = new TextEncoder();

  if (body.protocol !== 2) {
    // Legacy plain-text path, unchanged: a page cached across a deploy still
    // posts the old body and must still get a plain-text stream. It returns
    // from here, so the two paths never interleave.
    let stream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>;
    try {
      stream = await streamAssistantReply(baseMessages);
    } catch {
      return json({ error: 'upstream_error' }, 502);
    }

    const legacyBody = new ReadableStream<Uint8Array>({
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
    return new Response(legacyBody, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const ctx: ToolContext = {
    userId,
    registered,
    tier,
    lang: sanitizeLang(cookies),
    visitorKey,
    // The reading quota lives in a different namespace from the chat quota:
    // `usage_daily` is keyed by user id, else by the site's `user_id` cookie.
    // A visitor with neither has never drawn, so falling back to the visitor
    // key looks up nothing, which is the truthful answer rather than a stale one.
    usageSubject: userId ?? cookies.get('user_id')?.value ?? visitorKey,
    db: env.DB,
    origin: new URL(request.url).origin,
  };

  const responseBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      // Same charging rule as the legacy path: one message, charged once, on
      // the first delivered text chunk. Read hops are free.
      let charged = false;
      try {
        const turn = runAssistantTurn({
          messages: baseMessages,
          ctx,
          secret: env.SESSION_SECRET,
          callModel: async (messages, tools) => {
            // The loop types tools as `unknown[]` so it does not depend on the
            // provider SDK; this is the one seam where they meet.
            const reply = await callAssistantModel(
              messages,
              tools as Parameters<typeof callAssistantModel>[1]
            );
            const assistantMessage = reply.choices[0]?.message;
            const calls = assistantMessage?.tool_calls ?? [];
            return {
              // Pass the provider's own assistant turn through: the real
              // message is always better than a reconstruction of it.
              assistantMessage,
              toolCalls: calls.flatMap((c) =>
                c.type === 'function'
                  ? [{ id: c.id, name: c.function.name, args: safeParseArgs(c.function.arguments) }]
                  : []
              ),
            };
          },
          streamModel: (messages) => streamAssistantReply(messages),
          onFirstText: async () => {
            if (charged) return;
            await incrementChatUsage(visitorKey, env.DB);
            charged = true;
          },
        });
        for await (const event of turn) send(event);
        // Report what was actually charged. A turn that delivered no text
        // charged nothing, and this is the number the widget displays.
        send({ t: 'done', remaining: Math.max(0, quota.remaining - (charged ? 1 : 0)) });
      } catch (e) {
        // A throw anywhere in the turn still has to close the stream with a
        // frame the client can act on, rather than leaving it hanging.
        console.error('assistant turn error:', e);
        // The client may already be gone, in which case enqueueing throws;
        // that is not a second failure worth reporting.
        try {
          send({ t: 'done', error: 'upstream_error' });
        } catch {
          /* stream already closed */
        }
      }
      try {
        controller.close();
      } catch {
        /* stream already closed */
      }
    },
  });
  return new Response(responseBody, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
