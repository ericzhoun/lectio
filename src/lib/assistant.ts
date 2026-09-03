// src/lib/assistant.ts
// Inspire Assistant: quota constants, grounding facts and prompt assembly.
// Design: docs/superpowers/specs/2026-09-01-web-assistant-design.md
import OpenAI from 'openai';
import type { Lang } from './tarot';
import { ANON_DAILY_DRAWS, REGISTERED_DAILY_DRAWS, QUOTA, type Tier } from './entitlements';

/** Daily chat-message limits (design section 2). */
export const ANON_DAILY_MESSAGES = 10;
export const REGISTERED_DAILY_MESSAGES = 30;
export const CHAT_QUOTA: Record<Tier, number> = { free: REGISTERED_DAILY_MESSAGES, basic: 100, pro: 100 };

export const ASSISTANT_MODEL = 'gpt-5.4-nano';
export const ASSISTANT_MAX_COMPLETION_TOKENS = 500;
/** Conversation turns sent to the model as history (server-side cap). */
export const HISTORY_TURNS_SENT = 10;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ReadingContextItem {
  /** Card name or verse reference as displayed, e.g. "The Tower (塔)". */
  name: string;
  position: string;
  reversed: boolean;
  /** Interpretation shown on the page; '' when hidden (gated draw). */
  interp: string;
}

export interface ReadingContext {
  mode: 'tarot' | 'bible';
  spread: string;
  question: string;
  items: ReadingContextItem[];
}

export interface PageContext {
  path: string;
  title: string;
  reading: ReadingContext | null;
}

export interface VisitorInfo {
  registered: boolean;
  tier: Tier;
}

export function chatQuotaFor(visitor: VisitorInfo): number {
  if (!visitor.registered) return ANON_DAILY_MESSAGES;
  return CHAT_QUOTA[visitor.tier];
}

export function evaluateChatQuota(
  visitor: VisitorInfo,
  used: number
): { ok: boolean; remaining: number } {
  const remaining = Math.max(0, chatQuotaFor(visitor) - used);
  return { ok: remaining > 0, remaining };
}

/** Site facts the site-guide role must ground on (keep in sync with /pricing). */
export function buildGroundingFacts(): string {
  return [
    'Inspiration Tarot (dramatherapy.us) plans and limits, as shown on /pricing:',
    `- Free: guests ${ANON_DAILY_DRAWS} single-card draws/day; registered users ${REGISTERED_DAILY_DRAWS}/day plus one-time trial credits (3-card x${3}, Celtic Cross x${1}).`,
    `- Basic: $4.99/mo (annual $2.99/mo, billed $35.88/yr). Single and 3-card spreads, ${QUOTA.basic} draws/day, reading history.`,
    '- Pro: $11.99/mo (annual $7.19/mo, billed $86.28/yr). All spreads, unlimited draws, reading history.',
    '- First month free: monthly plans start with a 30-day Stripe trial (payment method collected, nothing charged until the trial ends, cancel anytime, one trial per account).',
    `- Chat assistant limits: guests ${ANON_DAILY_MESSAGES} messages/day, registered free ${CHAT_QUOTA.free} messages/day, Basic and Pro ${CHAT_QUOTA.basic} messages/day.`,
    'Site pages: / (draw tarot or Bible-verse readings), /library (78-card library), /history (past readings, logged in), /pricing (plans + billing portal access), /account (plan status), /approach, /privacy.',
  ].join('\n');
}

export function buildSystemPrompt(opts: {
  lang: Lang;
  context: PageContext | null;
  grounding: string;
}): string {
  const langName = opts.lang === 'zh' ? 'Chinese' : 'English';
  const role =
    'You are the Inspire Assistant, the warm, grounded companion on the Inspiration Tarot website ' +
    '(a tarot and Bible-verse reading site for self-reflection). You serve three roles and pick per message: ' +
    '(1) Reading companion: help with the reading currently on screen - explain the drawn cards or verses, ' +
    'their positions and reversals, suggest spreads, and guide beginners through their first draw. ' +
    '(2) Spiritual chat: reflective, encouraging, non-judgmental conversation about what the visitor is going through; ' +
    'never push the product. ' +
    '(3) Site guide: answer how-to, plan and credit questions using ONLY the site facts below; ' +
    'if an answer is not covered by them, say you are not sure and point to /pricing, /account or /privacy ' +
    'instead of guessing numbers or policies.';
  const rules =
    'Rules: Reference only the cards or verses that appear in the reading context below; never invent draws. ' +
    'In Bible mode cite only the drawn verses. Never give medical, legal or financial directives; ' +
    'if someone seems to be in crisis, respond with warmth and suggest professional help or local emergency services. ' +
    'Gently deflect off-brand tangents (politics, coding help, homework) back to reflection or site topics. ' +
    'Keep replies concise (2-5 short paragraphs at most). ' +
    'Formatting: replies render in a small chat bubble - write short paragraphs and use simple markdown only ' +
    '(**bold**, dash or numbered lists, [label](/path) links to site pages); ' +
    'never use markdown headings (#), tables, code blocks or horizontal rules. ' +
    `Default to writing in ${langName}; if the visitor writes in another language, reply in theirs.`;
  const parts = [role, rules, `Site facts:\n${opts.grounding}`];

  if (opts.context) {
    // Two spaces after the path are intentional — the prompt contract asserts
    // `${path}  ("${title}")` (see __tests__/assistant.test.ts).
    parts.push(`Visitor is currently on ${opts.context.path}  ("${opts.context.title}").`);
    const r = opts.context.reading;
    if (r) {
      let s = `Reading on screen - mode: ${r.mode}; spread: ${r.spread}; question: ${r.question || '(none)'}; drawn:`;
      for (const it of r.items) {
        s += `\n- ${it.name}${it.position ? ` [${it.position}]` : ''}${it.reversed ? ' [Reversed]' : ''}: ${it.interp || '(no interpretation shown)'}`;
      }
      parts.push(s);
    }
  } else {
    parts.push('No page context was provided for this message.');
  }
  return parts.join('\n\n');
}

// Created lazily on first use: the OpenAI constructor throws without a key,
// so creating at import time would make merely importing this module throw.
let client: OpenAI | null = null;

/** Streaming chat completion against the site model. */
export async function streamAssistantReply(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.chat.completions.create({
    model: ASSISTANT_MODEL,
    messages,
    temperature: 0.7,
    max_completion_tokens: ASSISTANT_MAX_COMPLETION_TOKENS,
    stream: true,
  });
}
