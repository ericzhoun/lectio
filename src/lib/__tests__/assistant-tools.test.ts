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
vi.mock('../usage', () => ({ getTodayUsage: vi.fn(async () => 2) }));
vi.mock('../credits', () => ({ getCreditBalance: vi.fn(async () => ({ '3card': 3, celtic_cross: 1 })) }));
vi.mock('../users', () => ({ getUserById: vi.fn(async () => ({ id: 'u1', email: 'reader@example.com', name: 'Reader' })) }));

import { ASSISTANT_TOOLS, getTool, validateArgs, toolSchemasFor, type ToolContext } from '../assistantTools';
import { ensureSubscriberTable, addSubscriber, resetSubscriberTableCache } from '../subscribers';

async function ctx(overrides: Partial<ToolContext> = {}): Promise<ToolContext> {
  const db = new D1Memory() as unknown as D1Database;
  // Each ctx() gets a fresh in-memory D1, so the module-level "already created"
  // guard has to be cleared or the second database never gets its table.
  resetSubscriberTableCache();
  await ensureSubscriberTable(db);
  return {
    userId: 'u1', registered: true, tier: 'free', lang: 'en',
    visitorKey: 'u:u1', db, origin: 'https://enjoyhim.org', ...overrides,
  };
}

describe('registry invariants', () => {
  it('never exposes identity as a model-supplied parameter', () => {
    for (const tool of ASSISTANT_TOOLS) {
      for (const name of Object.keys(tool.params)) {
        expect(['user_id', 'userId', 'tier', 'visitor_key', 'quota']).not.toContain(name);
      }
    }
  });

  it('gives every write tool a card summary', () => {
    for (const tool of ASSISTANT_TOOLS) {
      if (tool.kind === 'write') expect(typeof tool.summarize).toBe('function');
    }
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

  it('reports a guest without inventing account data', async () => {
    const me = (await getTool('get_me')!.run(
      {}, await ctx({ userId: null, registered: false, visitorKey: 'a:x' })
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
