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
    // Static-assets binding. The prebuilt-clip lookup runs before synthesis;
    // a 404 here sends the endpoint down the synthesis path these tests cover.
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  },
}));

import { GET } from '../../pages/api/tts';
import { TTS_CHUNK_MAX_CHARS, TTS_TEXT_MAX_CHARS, TTS_MODEL } from '../tts';
import { focusReference, getLectionaryDay } from '../lectionary';
import { resolvePassage } from '../passage';

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
  it('speaks guidance when the prebuilt step file is missing', async () => {
    const res = await call('?step=lectio&lang=en');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
    expect(store.runs).toEqual([[TTS_MODEL, { prompt: 'Read it slowly, twice. There is no hurry.', lang: 'en' }]]);
  });

  it('rejects arbitrary guidance text without synthesizing it', async () => {
    const res = await call('?step=arbitrary-text&lang=en');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_step' });
    expect(store.runs).toEqual([]);
  });

  it("speaks the day's passage as audio/mpeg", async () => {
    const res = await call(`?day=${DAY}&lang=en`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    const runs = store.runs as [string, { prompt: string; lang: string }][];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every(([model]) => model === TTS_MODEL)).toBe(true);
    expect(runs.every(([, i]) => i.lang === 'en' && i.prompt.length > 0)).toBe(true);
    // One clip, however many calls it took to say it.
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(3 * runs.length);
  });

  it('reads Chinese when asked, and English for anything else', async () => {
    const langsFor = async (query: string) => {
      store.runs = [];
      await call(query);
      return [...new Set((store.runs as [string, { lang: string }][]).map(([, i]) => i.lang))];
    };
    expect(await langsFor(`?day=${DAY}&lang=zh`)).toEqual(['zh']);
    expect(await langsFor(`?day=${DAY}&lang=fr`)).toEqual(['en']);
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
    const afterFirst = store.runs.length;
    expect(afterFirst).toBeGreaterThan(0);
    const second = await call(`?day=${DAY}&lang=fr`);
    expect(second.status).toBe(200);
    expect(store.runs).toHaveLength(afterFirst);
  });

  // Most English gospel readings are longer than one model call, and used to be
  // cut off at 1000 characters with no sign to the listener.
  it('reads a long passage right to the end, across as many calls as it takes', async () => {
    const long = Object.keys(
      (await import('../lectionaryDays.json')).default as Record<string, unknown>,
    ).find((d) => (resolvePassage(focusReference(getLectionaryDay(d)), 'en')?.text?.length ?? 0)
      > TTS_CHUNK_MAX_CHARS)!;
    const spoken = resolvePassage(focusReference(getLectionaryDay(long)), 'en')!.text
      .replace(/\s+/g, ' ').trim();

    const res = await call(`?day=${long}&lang=en`);
    expect(res.status).toBe(200);
    const prompts = (store.runs as [string, { prompt: string }][]).map(([, i]) => i.prompt);
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts.every((p) => p.length <= TTS_CHUNK_MAX_CHARS)).toBe(true);
    expect(prompts.join(' ')).toBe(spoken);
  });

  it('has a ceiling no lectionary reading reaches, so none is ever cut short', async () => {
    const days = Object.keys(
      (await import('../lectionaryDays.json')).default as Record<string, unknown>,
    );
    const longest = Math.max(...days.flatMap((d) => (['en', 'zh'] as const).map(
      (lang) => resolvePassage(focusReference(getLectionaryDay(d)), lang)?.text?.length ?? 0,
    )));
    expect(longest).toBeLessThanOrEqual(TTS_TEXT_MAX_CHARS);
  });
});
