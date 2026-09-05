import { describe, it, expect, beforeEach } from 'vitest';
import { D1Memory } from './helpers/d1-memory';
import {
  ensureSession, getSession, saveStepEntry, getStepEntries, advanceTo,
  completeSession, listSessions, canOpenStep,
} from '../dailySession';

let db: any;
beforeEach(() => { db = new D1Memory(); });

describe('canOpenStep', () => {
  it('permits the reached step and anything before it', () => {
    expect(canOpenStep('oratio', 'lectio')).toBe(true);
    expect(canOpenStep('oratio', 'oratio')).toBe(true);
  });

  it('permits exactly one step ahead, so the walk can proceed', () => {
    expect(canOpenStep('silencio', 'lectio')).toBe(true);
    expect(canOpenStep('lectio', 'meditatio')).toBe(true);
  });

  it('refuses jumping further ahead', () => {
    expect(canOpenStep('lectio', 'oratio')).toBe(false);
    expect(canOpenStep('lectio', 'actio')).toBe(false);
    expect(canOpenStep('silencio', 'meditatio')).toBe(false);
  });
});

describe('ensureSession', () => {
  it('creates a session at silencio', async () => {
    const s = await ensureSession('u1', '2026-09-04', 'en', db);
    expect(s.reachedStep).toBe('silencio');
    expect(s.completedAt).toBeNull();
    expect(s.lang).toBe('en');
  });

  it('is idempotent and does not change the pinned language', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await advanceTo('u1', '2026-09-04', 'oratio', db);
    const again = await ensureSession('u1', '2026-09-04', 'zh', db);
    expect(again.lang).toBe('en');
    expect(again.reachedStep).toBe('oratio');
  });
});

describe('saveStepEntry', () => {
  it('stores the reader text and the model text', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'the bridegroom', 'A gentle reply.', db);
    const entries = await getStepEntries('u1', '2026-09-04', db);
    expect(entries).toEqual([
      { step: 'meditatio', userText: 'the bridegroom', aiText: 'A gentle reply.' },
    ]);
  });

  it('keeps a null model text without failing', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'new wine', null, db);
    const [entry] = await getStepEntries('u1', '2026-09-04', db);
    expect(entry.aiText).toBeNull();
    expect(entry.userText).toBe('new wine');
  });

  it('edits rather than duplicates on resubmit', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'first', null, db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'second', 'reply', db);
    const entries = await getStepEntries('u1', '2026-09-04', db);
    expect(entries).toHaveLength(1);
    expect(entries[0].userText).toBe('second');
  });

  it('returns entries in step order regardless of write order', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await saveStepEntry('u1', '2026-09-04', 'actio', 'c', null, db);
    await saveStepEntry('u1', '2026-09-04', 'meditatio', 'a', null, db);
    await saveStepEntry('u1', '2026-09-04', 'oratio', 'b', null, db);
    expect((await getStepEntries('u1', '2026-09-04', db)).map((e) => e.step))
      .toEqual(['meditatio', 'oratio', 'actio']);
  });
});

describe('advanceTo', () => {
  it('never moves the reached step backwards', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await advanceTo('u1', '2026-09-04', 'oratio', db);
    await advanceTo('u1', '2026-09-04', 'lectio', db);
    expect((await getSession('u1', '2026-09-04', db))!.reachedStep).toBe('oratio');
  });
});

describe('completeSession', () => {
  it('stamps completion', async () => {
    await ensureSession('u1', '2026-09-04', 'en', db);
    await completeSession('u1', '2026-09-04', db);
    expect((await getSession('u1', '2026-09-04', db))!.completedAt).toBeTruthy();
  });
});

describe('listSessions', () => {
  it("returns a user's own days, newest first", async () => {
    await ensureSession('u1', '2026-09-03', 'en', db);
    await ensureSession('u1', '2026-09-04', 'en', db);
    await ensureSession('u2', '2026-09-04', 'en', db);
    const rows = await listSessions('u1', 10, db);
    expect(rows.map((r) => r.day)).toEqual(['2026-09-04', '2026-09-03']);
  });
});
