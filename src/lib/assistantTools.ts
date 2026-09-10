// Everything the assistant is allowed to do, in one place. A tool declares its
// arguments, whether it reads or writes, and who may call it; the server builds
// the context from cookies. No tool takes an identity parameter, so a model
// that invents one has nothing to bind it to.
import type { D1Database } from '@cloudflare/workers-types';
import type { Lang } from './reading';
import {
  ANON_DAILY_DRAWS, QUOTA, type Tier,
} from './entitlements';
import { chatQuotaFor } from './assistant';
import { getTodayUsage } from './usage';
import { getChatUsage } from './chatUsage';
import { getCreditBalance } from './credits';
import { getReadingsForUser } from './db';
import { getUserById } from './users';
import { getSubscriber } from './subscribers';
import { getLibraryVerses } from './scripture';

export interface ToolContext {
  userId: string | null;
  registered: boolean;
  tier: Tier;
  lang: Lang;
  /** `u:<userId>` or `a:<uuid>`; the card-binding subject. */
  visitorKey: string;
  db: D1Database;
  origin: string;
}

export interface ToolParam {
  type: 'string' | 'number';
  description: string;
  required?: boolean;
  enum?: string[];
  maxLength?: number;
}

export interface CardSummary {
  title: string;
  fields: { label: string; value: string }[];
  confirmLabel: string;
}

export interface AssistantTool {
  name: string;
  description: string;
  kind: 'read' | 'write';
  auth: 'any' | 'user';
  params: Record<string, ToolParam>;
  /** Coerce validated args into their canonical stored form (lowercase email, checked tz). */
  normalize?(args: Record<string, unknown>, ctx: ToolContext): Record<string, unknown>;
  /** Labeled fields the confirm card shows. Required for writes. */
  summarize?(args: Record<string, unknown>, ctx: ToolContext): CardSummary;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const readTools: AssistantTool[] = [
  {
    name: 'get_me',
    description:
      'Facts about the visitor asking: whether they are signed in, their plan, how many readings and chat messages they have left today, their trial credits, and whether they receive the daily invitation email. Call this before answering any question about "my" plan, limits, credits or email.',
    kind: 'read',
    auth: 'any',
    params: {},
    async run(_args, ctx) {
      const usageSubject = ctx.userId ?? ctx.visitorKey;
      const usedToday = await getTodayUsage(usageSubject);
      const chatUsed = await getChatUsage(ctx.visitorKey, ctx.db);
      // QUOTA.free is REGISTERED_DAILY_DRAWS, so the tier lookup covers every
      // registered visitor; only anonymous ones have a separate allowance.
      const readingLimit = ctx.registered ? QUOTA[ctx.tier] : ANON_DAILY_DRAWS;
      const base: Record<string, unknown> = {
        registered: ctx.registered,
        tier: ctx.tier,
        // QUOTA.pro is Infinity, and JSON.stringify(Infinity) is null, which a
        // model reads as none left. Say so in words instead.
        readings_left_today: Number.isFinite(readingLimit)
          ? Math.max(0, readingLimit - usedToday)
          : 'unlimited',
        chat_messages_left_today: Math.max(0, chatQuotaFor({ registered: ctx.registered, tier: ctx.tier }) - chatUsed),
      };
      if (!ctx.userId) return base;

      const user = await getUserById(ctx.userId, ctx.db);
      base.credits = await getCreditBalance(ctx.userId, ctx.db);
      if (user?.email) {
        base.email = user.email;
        const sub = await getSubscriber(ctx.db, user.email);
        base.daily_email = sub
          ? { subscribed: sub.status === 'active', status: sub.status, lang: sub.lang, timezone: sub.tz }
          : { subscribed: false, status: 'none' };
      }
      return base;
    },
  },
  {
    name: 'list_readings',
    description:
      "The visitor's own past readings, most recent first: id, date, question and the verses they received. Use it to answer questions about their history.",
    kind: 'read',
    auth: 'user',
    params: {
      limit: { type: 'number', description: 'How many readings to return, 1 to 20. Defaults to 5.' },
    },
    async run(args, ctx) {
      const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5) || 5));
      const rows = await getReadingsForUser(ctx.userId as string, limit);
      return {
        readings: rows.map((r) => ({
          id: r.id,
          date: r.timestamp,
          question: r.question,
          verses: r.verses,
        })),
      };
    },
  },
  {
    name: 'get_reading',
    description:
      "One of the visitor's own past readings in full, including the reflection, so it can be discussed.",
    kind: 'read',
    auth: 'user',
    params: {
      reading_id: { type: 'number', description: 'The id from list_readings.', required: true },
    },
    async run(args, ctx) {
      const wanted = Number(args.reading_id);
      const rows = await getReadingsForUser(ctx.userId as string, 50);
      const row = rows.find((r) => r.id === wanted);
      // Scoped by user id in the query above: an id belonging to someone else
      // simply is not in this list, so there is nothing to leak.
      if (!row) return { error: 'not_found' };
      return {
        id: row.id,
        date: row.timestamp,
        question: row.question,
        verses: row.verses,
        reflection: row.interpretation,
      };
    },
  },
  {
    name: 'list_verses',
    description:
      'Search the Lectio verse library (148 passages) by reference or theme. Use it to ground any answer about which passages the site contains.',
    kind: 'read',
    auth: 'any',
    params: {
      query: { type: 'string', description: 'A reference, book name or theme word.', required: true, maxLength: 100 },
    },
    async run(args) {
      const q = String(args.query).toLowerCase();
      const matches = getLibraryVerses()
        .filter(
          (v) =>
            v.refEn.toLowerCase().includes(q) ||
            v.themeEn.toLowerCase().includes(q) ||
            v.textEn.toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map((v) => ({ reference: v.refEn, theme: v.themeEn, text: v.textEn }));
      return { matches };
    },
  },
];

export const ASSISTANT_TOOLS: AssistantTool[] = [...readTools];

export function getTool(name: string): AssistantTool | null {
  return ASSISTANT_TOOLS.find((t) => t.name === name) ?? null;
}

export function validateArgs(
  tool: AssistantTool,
  raw: unknown
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(tool.params)) {
    const value = input[name];
    if (value === undefined || value === null || value === '') {
      if (spec.required) return { ok: false, error: `missing required argument: ${name}` };
      continue;
    }
    if (spec.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a number` };
      args[name] = n;
      continue;
    }
    const s = String(value).trim().slice(0, spec.maxLength ?? 200);
    if (spec.enum && !spec.enum.includes(s)) {
      return { ok: false, error: `${name} must be one of: ${spec.enum.join(', ')}` };
    }
    args[name] = s;
  }
  // Unknown keys are dropped, never forwarded: the model does not get to widen
  // a tool's surface by inventing arguments.
  return { ok: true, args };
}

export function toolSchemasFor(
  ctx: ToolContext
): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return ASSISTANT_TOOLS.filter((t) => t.auth === 'any' || ctx.userId).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(t.params).map(([name, spec]) => [
            name,
            {
              type: spec.type,
              description: spec.description,
              ...(spec.enum ? { enum: spec.enum } : {}),
            },
          ])
        ),
        required: Object.entries(t.params)
          .filter(([, spec]) => spec.required)
          .map(([name]) => name),
      },
    },
  }));
}
