// Everything the assistant is allowed to do, in one place. A tool declares its
// arguments, whether it reads or writes, and who may call it; the server builds
// the context from cookies. No tool takes an identity parameter, so a model
// that invents one has nothing to bind it to.
import type { D1Database } from '@cloudflare/workers-types';
import { env } from 'cloudflare:workers';
import { SPREADS, type Lang } from './reading';
import {
  ANON_DAILY_DRAWS, QUOTA, type Tier,
} from './entitlements';
import { chatQuotaFor } from './assistant';
import { getTodayUsage } from './usage';
import { getChatUsage } from './chatUsage';
import { getCreditBalance } from './credits';
import { getReadingsForUser } from './db';
import { getUserById } from './users';
import { addSubscriber, ensureSubscriberTable, getSubscriber, setStatus } from './subscribers';
import { getLibraryVerses } from './scripture';
import { isValidTimeZone } from './localDay';
import { DEFAULT_TIMEZONE } from './mailSchedule';
import { performDraw } from './draw';
import { getSubscription } from './subscriptions';
import { getStripeClient } from './stripe';
import { sendUnsubscribeLink } from './unsubscribe';

export interface ToolContext {
  userId: string | null;
  registered: boolean;
  tier: Tier;
  lang: Lang;
  /** `u:<userId>` or `a:<uuid>`; the card-binding and chat-quota subject. */
  visitorKey: string;
  /**
   * The reading-quota subject, which is a different namespace from `visitorKey`:
   * the signed-in user id, else the site's `user_id` cookie value, else the
   * visitor key. `usage_daily` rows are keyed this way, so anything else looks
   * up nothing and reports a full allowance to someone who has spent it.
   * Built in src/lib/assistantContext.ts, which mints a `user_id` for a guest
   * on the confirm path rather than billing them to a bucket the site never
   * reads; the visitor-key fallback is only ever reached on the read path,
   * where a visitor with no site id has genuinely never drawn.
   */
  usageSubject: string;
  db: D1Database;
  origin: string;
}

/**
 * Thrown by `normalize` when an argument cannot be made into a usable form.
 * The loop turns it into a tool result the model can act on, rather than a
 * generic failure, so a bad value is corrected instead of being signed into a
 * card the visitor is shown and only fails after the tap.
 */
export class ToolArgumentError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ToolArgumentError';
  }
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
      const usedToday = await getTodayUsage(ctx.usageSubject);
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
        // Nothing creates daily_invitations at deploy time, and the "already
        // created" guard is per-isolate: an isolate whose first touch of the
        // table is the assistant would otherwise query a table that is missing
        // (or production's legacy three-column one).
        await ensureSubscriberTable(ctx.db);
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

// A write tool is a proposal, never an action. The chat loop never calls `run`:
// it builds a signed confirm card from `normalize` + `summarize`, and only the
// visitor's tap on that card reaches `run`. So `normalize` has to produce the
// exact form that will be stored, and `summarize` has to name everything that
// will happen, including what it costs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const writeTools: AssistantTool[] = [
  {
    name: 'subscribe_daily_email',
    description:
      'Propose signing an address up for the Daily Invitation email (one passage each morning). The visitor confirms before anything is stored.',
    kind: 'write',
    auth: 'any',
    params: {
      email: { type: 'string', description: 'The address to subscribe.', required: true, maxLength: 254 },
      lang: { type: 'string', description: 'Language of the email.', enum: ['en', 'zh'] },
      tz: { type: 'string', description: 'IANA timezone, so the email arrives at 6am local time.', maxLength: 80 },
    },
    normalize(args, ctx) {
      const email = String(args.email ?? '').trim().toLowerCase();
      // Checked here, not only in `run`: a card is a promise to the visitor,
      // and an address that cannot work must never reach one.
      if (!EMAIL_RE.test(email)) throw new ToolArgumentError('invalid_email');
      return {
        email,
        lang: args.lang === 'zh' || args.lang === 'en' ? args.lang : ctx.lang,
        // addSubscriber falls back the same way; doing it here too means the
        // card shows the zone that will actually be stored.
        tz: isValidTimeZone(args.tz) ? args.tz : DEFAULT_TIMEZONE,
      };
    },
    summarize(args) {
      return {
        title: 'Subscribe to the Daily Invitation',
        fields: [
          { label: 'Email', value: String(args.email ?? '') },
          { label: 'Language', value: args.lang === 'zh' ? '中文' : 'English' },
          { label: 'Arrives', value: `6am ${String(args.tz ?? DEFAULT_TIMEZONE)}` },
          { label: 'Costs', value: 'nothing; unsubscribe from any email' },
        ],
        confirmLabel: 'Subscribe',
      };
    },
    async run(args, ctx) {
      const email = String(args.email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
      // addSubscriber does not create the table, and the guard behind this call
      // is per-isolate module state: without it, an isolate whose first
      // subscriber write is the assistant's INSERT fails after the visitor has
      // already tapped confirm.
      await ensureSubscriberTable(ctx.db);
      await addSubscriber(ctx.db, {
        email,
        lang: args.lang === 'zh' ? 'zh' : 'en',
        tz: isValidTimeZone(args.tz) ? args.tz : DEFAULT_TIMEZONE,
      });
      return { subscribed: true, email };
    },
  },
  {
    name: 'unsubscribe_daily_email',
    description:
      "Propose stopping the Daily Invitation email. Only the signed-in visitor's own address stops immediately; any other address is sent an unsubscribe link instead.",
    kind: 'write',
    auth: 'any',
    params: {
      email: { type: 'string', description: 'The address to stop.', required: true, maxLength: 254 },
    },
    normalize(args) {
      return { email: String(args.email ?? '').trim().toLowerCase() };
    },
    summarize(args) {
      return {
        title: 'Stop the Daily Invitation',
        fields: [
          { label: 'Email', value: String(args.email ?? '') },
          {
            label: 'What happens',
            value:
              'If this is your own signed-in address it stops right away; otherwise an unsubscribe link is emailed to it.',
          },
        ],
        confirmLabel: 'Unsubscribe',
      };
    },
    async run(args, ctx) {
      const email = String(args.email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
      // Chat is not proof that you own an address. Only the signed-in
      // visitor's own address may be stopped from here; anyone else gets the
      // same emailed link the newsletter footer carries. A guest has proved
      // nothing at all, so they always get the link.
      const owner = ctx.userId ? await getUserById(ctx.userId, ctx.db) : null;
      if (owner?.email && owner.email.trim().toLowerCase() === email) {
        await ensureSubscriberTable(ctx.db);
        await setStatus(ctx.db, email, 'unsubscribed');
        return { applied: true, email };
      }
      await sendUnsubscribeLink(email, ctx.db, ctx.origin);
      return { applied: false, emailed_link: true, email };
    },
  },
  {
    name: 'start_reading',
    description:
      'Propose receiving a scripture reading now, for a question the visitor has given. Confirming spends a reading from their daily quota (or a trial credit for the multi-verse layouts).',
    kind: 'write',
    auth: 'any',
    params: {
      question: { type: 'string', description: "The visitor's question, in their own words.", required: true, maxLength: 300 },
      layout: { type: 'string', description: 'Which layout to use.', enum: ['single', '3card', 'celtic_cross'] },
    },
    normalize(args) {
      const layout = typeof args.layout === 'string' && args.layout in SPREADS ? args.layout : 'single';
      return { question: String(args.question ?? '').trim().slice(0, 300), layout };
    },
    summarize(args, ctx) {
      const key = String(args.layout ?? 'single');
      const spread = SPREADS[key] ?? SPREADS.single;
      return {
        title: 'Receive a reading',
        fields: [
          { label: 'Question', value: String(args.question ?? '') },
          { label: 'Layout', value: spread.name[ctx.lang] },
          {
            label: 'Costs',
            value: key === 'single' ? "one of today's readings" : 'one trial credit',
          },
        ],
        confirmLabel: 'Receive',
      };
    },
    async run(args, ctx) {
      const outcome = await performDraw({
        question: String(args.question ?? '').trim().slice(0, 300),
        spreadKey: String(args.layout ?? 'single'),
        lang: ctx.lang,
        // The reading quota lives under usageSubject, not the chat visitor
        // key: billing a draw anywhere else spends from a bucket the site
        // itself never reads.
        userId: ctx.usageSubject,
        registered: ctx.registered,
        ipAddress: null,
      });
      if (outcome.kind !== 'reading') {
        return { error: outcome.kind === 'gated' ? 'registration_required' : outcome.reason };
      }
      return {
        kind: 'reading',
        readingId: outcome.readingId,
        spreadKey: outcome.spreadKey,
        question: String(args.question ?? ''),
        verses: outcome.verses.map((v) => ({
          reference: ctx.lang === 'zh' ? (v.refZh ?? v.refEn) : v.refEn,
          // The English ref is the verse's identity, not a display string:
          // rebuildDrawnVerses keys off it when the last_reading cookie is
          // redeemed, so it has to survive even a zh reading. Same for tags,
          // which the cached rendering needs.
          refEn: v.refEn,
          position: v.position ?? '',
          text: v.interp_text ?? '',
          tags: v.tags ?? [],
        })),
        summary: outcome.summary,
        followUps: outcome.followUps,
      };
    },
  },
  {
    name: 'open_billing',
    description:
      'Propose opening the Stripe billing portal, where the visitor can change or cancel their plan and see invoices. Only for someone who already has a subscription.',
    kind: 'write',
    auth: 'user',
    params: {},
    summarize() {
      return {
        title: 'Open your billing portal',
        fields: [
          { label: 'Opens', value: 'Stripe billing portal (new tab)' },
          { label: 'Costs', value: 'nothing; no plan changes until you make them there' },
        ],
        confirmLabel: 'Open',
      };
    },
    async run(_args, ctx) {
      // auth: 'user' means the loop never offers this without a userId, and the
      // id comes from the verified session cookie, never from the model.
      if (!ctx.userId) return { error: 'sign_in_required', next: '/login' };
      const sub = await getSubscription(ctx.userId);
      if (!sub?.stripeCustomerId) return { error: 'no_subscription', next: '/pricing' };
      const stripe = getStripeClient(env.STRIPE_SECRET_KEY as string);
      // The account-wide default portal configuration is shared with other
      // products, so use the Lectio-specific one when it is set - same as
      // /api/stripe/portal.
      const configuration = (env.STRIPE_PORTAL_CONFIG_ID as string | undefined) || undefined;
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${ctx.origin}/account`,
        ...(configuration ? { configuration } : {}),
      });
      return { url: portal.url };
    },
  },
];

export const ASSISTANT_TOOLS: AssistantTool[] = [...readTools, ...writeTools];

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
              // Tell the model the bound it is held to, or validateArgs truncates silently.
              ...(spec.maxLength ? { maxLength: spec.maxLength } : {}),
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
