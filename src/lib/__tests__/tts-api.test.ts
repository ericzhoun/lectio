// src/lib/__tests__/tts-api.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => ({
  runs: [] as unknown[],
  run: async (_model: string, _input: unknown) => ({ audio: 'SUQz' }) as unknown,
}));

vi.mock('cloudflare:workers', () => ({
  env: {
    AI: {
      run: (model: string, input: unknown) => {
        store.runs.push([model, input]);
        return store.run(model, input);
      },
    },
  },
}));

import { GET } from '../../pages/api/tts';
import { TTS_MODEL } from '../tts';

/** A day the built lectionary table certainly covers. */
const DAY = Object.keys(
  (await import('../lectionaryDays.json')).default as Record<string, unknown>,
)[10];

const call = (query: string) =>
  GET({ url: new URL(`https://lectio.test/api/tts${query}`) } as never);

// A no-op stand-in for the Workers cache, which does not exist under vitest.
const noCache = { match: async () => undefined, put: async () => {} };

beforeEach(() => {
  store.runs = [];
  store.run = async () => ({ audio: 'SUQz' });
  (globalThis as { caches?: unknown }).caches = { default: noCache };
});

describe('GET /api/tts', () => {
  it('speaks the day\'s passage as audio/mpeg', async () => {
    const res = await call(`?day=${DAY}&lang=en`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x49, 0x44, 0x33]),
    );
    const [[model, input]] = store.runs as [[string, { prompt: string; lang: string }]];
    expect(model).toBe(TTS_MODEL);
    expect(input.lang).toBe('en');
    expect(input.prompt.length).toBeGreaterThan(0);
  });

  it('reads Chinese when asked, and English for anything else', async () => {
    await call(`?day=${DAY}&lang=zh`);
    await call(`?day=${DAY}&lang=fr`);
    const langs = (store.runs as [string, { lang: string }][]).map(([, i]) => i.lang);
    expect(langs).toEqual(['zh', 'en']);
  });

  // The point of taking a day rather than text: nobody can bill the account
  // for synthesizing whatever they like.
  it('refuses days outside the lectionary table, and never calls the model', async () => {
    for (const q of ['', '?day=not-a-day', '?day=1066-10-14', '?day=<script>']) {
      const res = await call(q);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unknown_day' });
    }
    expect(store.runs).toEqual([]);
  });

  it('reports a synthesis failure as 502 rather than a broken audio file', async () => {
    store.run = async () => {
      throw new Error('model unavailable');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(`?day=${DAY}&lang=en`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'synthesis_failed' });
  });

  it('serves a cached day without paying for synthesis twice', async () => {
    const entries = new Map<string, Response>();
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async (req: Request) => entries.get(req.url)?.clone(),
        put: async (req: Request, res: Response) => void entries.set(req.url, res),
      },
    };
    await call(`?day=${DAY}&lang=en`);
    // 'lang=fr' normalizes to 'en', so it must land on the same cache entry.
    const second = await call(`?day=${DAY}&lang=fr`);
    expect(second.status).toBe(200);
    expect(store.runs).toHaveLength(1);
  });
});
