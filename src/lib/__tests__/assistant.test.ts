// src/lib/__tests__/assistant.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANON_DAILY_MESSAGES,
  REGISTERED_DAILY_MESSAGES,
  CHAT_QUOTA,
  chatQuotaFor,
  evaluateChatQuota,
  buildGroundingFacts,
  buildSystemPrompt,
  type PageContext,
} from '../assistant';

describe('chat quota rules', () => {
  it('gives anonymous visitors 10 messages/day', () => {
    expect(chatQuotaFor({ registered: false, tier: 'free' })).toBe(ANON_DAILY_MESSAGES);
  });

  it('gives registered free users 30 and paid tiers 100', () => {
    expect(chatQuotaFor({ registered: true, tier: 'free' })).toBe(REGISTERED_DAILY_MESSAGES);
    expect(chatQuotaFor({ registered: true, tier: 'basic' })).toBe(CHAT_QUOTA.basic);
    expect(chatQuotaFor({ registered: true, tier: 'pro' })).toBe(CHAT_QUOTA.pro);
  });

  it('evaluates quota state without going negative', () => {
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 0)).toEqual({ ok: true, remaining: 10 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 9)).toEqual({ ok: true, remaining: 1 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 10)).toEqual({ ok: false, remaining: 0 });
    expect(evaluateChatQuota({ registered: false, tier: 'free' }, 99)).toEqual({ ok: false, remaining: 0 });
  });
});

describe('buildGroundingFacts', () => {
  it('includes plan prices and limits matching the entitlements constants', () => {
    const g = buildGroundingFacts();
    expect(g).toContain('$4.99/mo');
    expect(g).toContain('$11.99/mo');
    expect(g).toContain('30-day');
    expect(g).toContain('10 messages/day');
    expect(g).toContain('30 messages/day');
  });
});

describe('buildSystemPrompt', () => {
  it('declares the three roles, safety rails and language rule', () => {
    const p = buildSystemPrompt({ lang: 'zh', context: null, grounding: buildGroundingFacts() });
    expect(p).toContain('Reading companion');
    expect(p).toContain('Spiritual chat');
    expect(p).toContain('Site guide');
    expect(p).toContain('Chinese');
    expect(p).toContain('medical, legal or financial');
    expect(p).toContain('crisis');
  });

  it('states when no page context is available', () => {
    const p = buildSystemPrompt({ lang: 'en', context: null, grounding: '' });
    expect(p).toContain('No page context');
  });

  it('embeds page and reading context with positions and reflections', () => {
    const ctx: PageContext = {
      path: '/',
      title: 'Lectio',
      reading: {
        spread: 'Lectio Divina',
        question: 'Will my move go well?',
        items: [{ name: 'Romans 8:28 (罗马书 8:28)', position: 'Oratio · Respond', interp: 'all things work together' }],
      },
    };
    const p = buildSystemPrompt({ lang: 'en', context: ctx, grounding: '' });
    expect(p).toContain('/  ("Lectio")');
    expect(p).toContain('Romans 8:28');
    expect(p).toContain('[Oratio · Respond]');
    expect(p).toContain('all things work together');
    expect(p).toContain('never invent them');
  });

  it('marks hidden reflections instead of pretending they exist', () => {
    const ctx: PageContext = {
      path: '/',
      title: 't',
      reading: { spread: 'Daily Word', question: '', items: [{ name: 'Psalm 23:1', position: '', interp: '' }] },
    };
    const p = buildSystemPrompt({ lang: 'en', context: ctx, grounding: '' });
    expect(p).toContain('(no reflection shown)');
  });
});
