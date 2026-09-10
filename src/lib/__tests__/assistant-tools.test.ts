import { describe, it, expect, vi } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('cloudflare:workers', () => ({ env: { DB: null, SESSION_SECRET: '***' } }));
vi.mock('../db', () => ({
  getReadingsForUser: vi.fn(async () => [
    { id: 7, question: 'What now?', verses: 'John 15:5 / 约翰福音 15:5', interpretation: 'abide', timestamp: '2026-09-01 08:00:00' },
  ]),
  getReadingRendering: vi.fn(async () => null),
}));
// Keyed by subject so a test can prove which subject the tool actually asked about.
vi.mock('../usage', () => ({
  getTodayUsage: vi.fn(async (subject: string) => (subject === 'anon-cookie-1' ? 3 : 2)),
}));
vi.mock('../credits', () => ({ getCreditBalance: vi.fn(async () => ({ '3card': 3, celtic_cross: 1 })) }));
vi.mock('../users', () => ({ getUserById: vi.fn(async () => ({ id: 'u1', email: 'reader@example.com', name: 'Reader' })) }));

import { ASSISTANT_TOOLS, getTool, validateArgs, toolSchemasFor, type ToolContext } from '../assistantTools';
import { ensureSubscriberTable, addSubscriber, resetSubscriberTableCache } from '../subscribers';
import { getTodayUsage } from '../usage';

async function ctx(overrides: Partial<ToolContext> = {}): Promise<ToolContext> {
  const db = new D1Memory() as unknown as D1Database;
  // Each ctx() gets a fresh in-memory D1, so the module-level "already created"
  // guard has to be cleared or the second database never gets its table.
  resetSubscriberTableCache();
  await ensureSubscriberTable(db);
  return {
    userId: 'u1', registered: true, tier: 'free', lang: 'en',
    visitorKey: 'u:u1', usageSubject: 'u1', db, origin: 'https://enjoyhim.org', ...overrides,
  };
}

describe('registry invariants', () => {
  it('never exposes identity as a model-supplied parameter', () => {
    // Catches any spelling of who-you-are (user_id, userId, visitorKey, account_id),
    // what-you-pay-for (tier, quota) and a borrowed address (user_email). A bare
    // `email` is deliberately allowed: for subscribe_daily_email it is the subject
    // of the write, not a claim about identity, and the write is confirmed anyway.
    const identityLike = /^(user|visitor|account)_?(id|key)$|^tier$|^quota$|_email$/i;
    for (const tool of ASSISTANT_TOOLS) {
      for (const name of Object.keys(tool.params)) {
        expect(name).not.toMatch(identityLike);
      }
    }
  });

  it('gives every write tool a card summary', () => {
    for (const tool of ASSISTANT_TOOLS) {
      if (tool.kind === 'write') expect(typeof tool.summarize).toBe('function');
    }
  });

  it('tells the model the length bound it will be held to', async () => {
    const schema = toolSchemasFor(await ctx()).find((t) => t.function.name === 'list_verses')!;
    const params = schema.function.parameters as { properties: Record<string, { maxLength?: number }> };
    expect(params.properties.query.maxLength).toBe(100);
  });

  it('hides user-only tools from a guest and shows them to a member', async () => {
    const guestNames = toolSchemasFor(await ctx({ userId: null, registered: false, visitorKey: 'a:x' }))
      .map((t) => t.function.name);
    expect(guestNames).not.toContain('list_readings');
    expect(guestNames).toContain('get_me');
    const memberNames = toolSchemasFor(await ctx()).map((t) => t.function.name);
    expect(memberNames).toContain('list_readings');
  });
});

describe('validateArgs', () => {
  it('rejects a missing required argument', () => {
    const tool = getTool('get_reading')!;
    expect(validateArgs(tool, {})).toEqual({ ok: false, error: expect.stringContaining('reading_id') });
  });

  // TODO(task-5): re-enable once subscribe_daily_email exists in the registry.
  it.skip('rejects a value outside an enum', () => {
    const tool = getTool('subscribe_daily_email')!;
    const result = validateArgs(tool, { email: 'a@b.com', lang: 'fr', tz: 'UTC' });
    expect(result.ok).toBe(false);
  });

  it('drops unknown arguments instead of passing them through', () => {
    const tool = getTool('list_readings')!;
    const result = validateArgs(tool, { limit: 5, user_id: 'someone-else' });
    expect(result).toEqual({ ok: true, args: { limit: 5 } });
  });
});

describe('get_me', () => {
  it('reports plan, quotas and daily-email state for a member', async () => {
    const c = await ctx();
    await addSubscriber(c.db, { email: 'reader@example.com', lang: 'en', tz: 'UTC' });
    const me = (await getTool('get_me')!.run({}, c)) as Record<string, unknown>;
    expect(me).toMatchObject({ registered: true, tier: 'free' });
    expect(me.readings_left_today).toBe(4); // REGISTERED_DAILY_DRAWS 6 - 2 used
    expect(me.credits).toEqual({ '3card': 3, celtic_cross: 1 });
    expect(me.daily_email).toMatchObject({ subscribed: true, status: 'active' });
  });

  it('says "unlimited" rather than a value JSON turns into null', async () => {
    // QUOTA.pro is Infinity, and JSON.stringify(Infinity) is null, which the
    // model would read as zero readings left.
    const me = (await getTool('get_me')!.run({}, await ctx({ tier: 'pro' }))) as Record<string, unknown>;
    expect(me.readings_left_today).toBe('unlimited');
    expect(JSON.parse(JSON.stringify(me)).readings_left_today).toBe('unlimited');
  });

  it("counts a guest's readings against their site cookie, not the chat visitor key", async () => {
    // The chat visitor key (a:<uuid>) and the site's user_id cookie are separate
    // namespaces; keying usage off the former always misses, so a guest who had
    // used their allowance would be told none of it was spent.
    vi.mocked(getTodayUsage).mockClear();
    const me = (await getTool('get_me')!.run(
      {}, await ctx({ userId: null, registered: false, visitorKey: 'a:x', usageSubject: 'anon-cookie-1' })
    )) as Record<string, unknown>;
    expect(getTodayUsage).toHaveBeenCalledWith('anon-cookie-1');
    expect(me.readings_left_today).toBe(0); // ANON_DAILY_DRAWS 3 - 3 used
  });

  it('reports a guest without inventing account data', async () => {
    const me = (await getTool('get_me')!.run(
      {}, await ctx({ userId: null, registered: false, visitorKey: 'a:x', usageSubject: 'a:x' })
    )) as Record<string, unknown>;
    expect(me).toMatchObject({ registered: false });
    expect(me.credits).toBeUndefined();
    expect(me.daily_email).toBeUndefined();
  });
});

describe('list_readings', () => {
  it('returns the visitor\'s own readings', async () => {
    const rows = (await getTool('list_readings')!.run({ limit: 5 }, await ctx())) as {
      readings: Array<Record<string, unknown>>;
    };
    expect(rows.readings[0]).toMatchObject({ id: 7, question: 'What now?' });
  });
});
