// src/pages/api/roblox/assistant.ts
// The Lectio Assistant for the world: same prompt, grounding and daily quota
// as the website's chat, answered non-streaming (Roblox HttpService cannot
// stream). Quota is charged only when reply text is actually delivered.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  HISTORY_TURNS_SENT,
  buildGroundingFacts,
  buildSystemPrompt,
  evaluateChatQuota,
  streamAssistantReply,
  type ChatTurn,
  type PageContext,
} from '../../../lib/assistant';
import { getChatUsage, incrementChatUsage } from '../../../lib/chatUsage';
import {
  buildRobloxState,
  getRobloxPlayer,
  guardRobloxRequest,
  json,
  readJsonBody,
  robloxPlayerKey,
  validPlayerId,
} from '../../../lib/roblox';

export const prerender = false;

const MESSAGE_MAX_CHARS = 1000;

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

/** The world sends what is on screen so the assistant answers in context. */
function sanitizeReading(raw: unknown): PageContext['reading'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(r.items) ? r.items.slice(0, 12) : [];
  return {
    spread: typeof r.spread === 'string' ? r.spread.slice(0, 100) : '',
    question: typeof r.question === 'string' ? r.question.slice(0, 300) : '',
    items: itemsRaw.map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        name: typeof o.name === 'string' ? o.name.slice(0, 100) : '',
        position: typeof o.position === 'string' ? o.position.slice(0, 100) : '',
        interp: typeof o.interp === 'string' ? o.interp.slice(0, 1000) : '',
      };
    }),
  };
}

export const POST: APIRoute = async ({ request }) => {
  const denied = guardRobloxRequest(request);
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!body || !validPlayerId(body.playerId)) {
    return json({ ok: false, error: 'invalid_player' }, 400);
  }
  const message = sanitizeMessage(body.message);
  if (!message) return json({ ok: false, error: 'empty_message' }, 400);
  const lang = body.lang === 'zh' ? 'zh' : 'en';

  const playerKey = robloxPlayerKey(body.playerId);
  const player = await getRobloxPlayer(env.DB, playerKey);

  const used = await getChatUsage(playerKey, env.DB);
  const quota = evaluateChatQuota({ registered: player.registered, tier: 'free' }, used);
  if (!quota.ok) {
    return json({ ok: false, errorKey: 'assistantLimitMsg', remaining: 0 });
  }

  const context: PageContext = {
    path: '/roblox',
    title: 'Lectio in Roblox',
    reading: sanitizeReading(body.reading),
  };
  const system = buildSystemPrompt({ lang, context, grounding: buildGroundingFacts() });
  const history = sanitizeHistory(body.history);

  let stream: AsyncIterable<{ choices: Array<{ delta?: { content?: string | null } }> }>;
  try {
    stream = await streamAssistantReply([
      { role: 'system', content: system },
      ...history.map((t) => ({ role: t.role, content: t.content }) as const),
      { role: 'user', content: message },
    ]);
  } catch {
    return json({ ok: false, errorKey: 'backendError' });
  }

  // Collect the stream, charging the quota on the first delivered chunk —
  // a model call that produces nothing stays free.
  let reply = '';
  let charged = false;
  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        if (!charged) {
          await incrementChatUsage(playerKey, env.DB);
          charged = true;
        }
        reply += delta;
      }
    }
  } catch (e) {
    console.error('roblox assistant stream error:', e);
    // Deliver the partial reply; a truncated tail beats an error toast.
  }
  if (!reply) {
    return json({ ok: false, errorKey: 'backendError' });
  }

  const state = await buildRobloxState(env.DB, playerKey, player.registered);
  return json({ ok: true, text: reply, remaining: state.chatRemaining, state });
};
