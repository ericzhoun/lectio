import { describe, it, expect, vi, beforeEach } from 'vitest';
import { D1Memory } from './helpers/d1-memory';

const generateStepResponse = vi.fn();
vi.mock('../dailyReflection', () => ({ generateStepResponse }));

const { handleStepSubmit } = await import('../dailySubmit');
const { ensureSession, getStepEntries, getSession } = await import('../dailySession');

let db: any;
const base = () => ({
  userId: 'u1',
  day: '2026-09-04',
  step: 'meditatio' as const,
  userText: 'new wine',
  passage: { ref: 'Luke 5:33-39', text: 'New wine into fresh wineskins.' },
  lang: 'en' as const,
  db,
});

beforeEach(async () => {
  db = new D1Memory();
  generateStepResponse.mockReset();
  await ensureSession('u1', '2026-09-04', 'en', db);
});

describe('handleStepSubmit', () => {
  it('saves the text and the model reply, then advances', async () => {
    generateStepResponse.mockResolvedValue({ text: 'A gentle reply.' });
    const result = await handleStepSubmit(base());
    expect(result.next).toBe('oratio');
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.userText).toBe('new wine');
    expect(entry.aiText).toBe('A gentle reply.');
    expect((await getSession('u1', '2026-09-04', db))!.reachedStep).toBe('oratio');
  });

  it('still saves and still advances when the model fails', async () => {
    generateStepResponse.mockResolvedValue({ text: null });
    const result = await handleStepSubmit(base());
    expect(result.next).toBe('oratio');
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.userText).toBe('new wine');
    expect(entry.aiText).toBeNull();
  });

  it('rejects empty writing without calling the model', async () => {
    const result = await handleStepSubmit({ ...base(), userText: '   ' });
    expect(result.error).toBe('empty');
    expect(generateStepResponse).not.toHaveBeenCalled();
    expect(await getStepEntries('u1', '2026-09-04', db)).toEqual([]);
  });

  it('passes prior steps to the model for continuity', async () => {
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit(base());
    generateStepResponse.mockClear();
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit({ ...base(), step: 'oratio', userText: 'I am afraid.' });
    expect(generateStepResponse.mock.calls[0][0].priorSteps).toEqual([
      { step: 'meditatio', userText: 'new wine' },
    ]);
  });

  it('skips the model on an unchanged resubmit', async () => {
    generateStepResponse.mockResolvedValue({ text: 'A gentle reply.' });
    await handleStepSubmit(base());
    generateStepResponse.mockClear();
    await handleStepSubmit(base());
    expect(generateStepResponse).not.toHaveBeenCalled();
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.aiText).toBe('A gentle reply.');
  });

  it('completes the session at actio', async () => {
    generateStepResponse.mockResolvedValue({ text: 'ok' });
    await handleStepSubmit({ ...base(), step: 'actio', userText: 'Call my brother.' });
    const session = await getSession('u1', '2026-09-04', db);
    expect(session!.completedAt).toBeTruthy();
  });
});
