import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class { chat = { completions: { create } }; },
}));

const { buildStepMessages, generateStepResponse } = await import('../dailyReflection');

const input = {
  step: 'oratio' as const,
  passage: { ref: 'Luke 5:33-39', text: 'No one pours new wine into old wineskins.' },
  userText: 'I am afraid of what changing would cost me.',
  priorSteps: [{ step: 'meditatio' as const, userText: 'new wine' }],
  lang: 'en' as const,
};

// A block body matters: an arrow returning the mock would be taken as a
// teardown callback and invoked after each test.
beforeEach(() => { create.mockReset(); });

describe('buildStepMessages', () => {
  it("carries the passage, the reader's words, and prior steps", () => {
    const [system, user] = buildStepMessages(input);
    expect(system.role).toBe('system');
    expect(user.content).toContain('Luke 5:33-39');
    expect(user.content).toContain('I am afraid');
    expect(user.content).toContain('new wine');
  });

  it("instructs oratio never to answer on God's behalf", () => {
    const [system] = buildStepMessages(input);
    expect(system.content).toMatch(/on God's behalf/i);
  });

  it("writes in the reader's language", () => {
    const [system] = buildStepMessages({ ...input, lang: 'zh' });
    expect(system.content).toContain('Chinese');
  });

  it('varies the instruction by step', () => {
    const med = buildStepMessages({ ...input, step: 'meditatio' })[0].content;
    const act = buildStepMessages({ ...input, step: 'actio' })[0].content;
    expect(med).not.toBe(act);
  });
});

describe('generateStepResponse', () => {
  it('returns the model text', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"text":"A gentle reply."}' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: 'A gentle reply.' });
  });

  it('returns null text when the call throws, and never throws itself', async () => {
    create.mockImplementation(() => { throw new Error('upstream 500'); });
    expect(await generateStepResponse(input)).toEqual({ text: null });
  });

  it('returns null text when the response is truncated', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '{"text":"half' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: null });
  });

  it('returns null text when the payload is not the expected shape', async () => {
    create.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'not json' } }],
    });
    expect(await generateStepResponse(input)).toEqual({ text: null });
  });
});
