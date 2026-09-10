import { describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { resolveRange, serveR2Audio } from '../r2Audio';

const SIZE = 1000;

/** A bucket holding one object; honours a "bytes=a-b" / "bytes=-n" Range header. */
function bucket(): R2Bucket {
  return {
    get: async (key: string, options?: { range?: Headers }) => {
      if (key !== 'music/x.mp3') return null;
      const header = options?.range?.get('Range');
      let range;
      if (header) {
        const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(header) ?? [];
        if (from === undefined) throw new Error('InvalidRange');
        if (from === '') range = { suffix: Number(to) };
        else if (Number(from) >= SIZE) throw new Error('InvalidRange');
        else range = { offset: Number(from), ...(to ? { length: Number(to) - Number(from) + 1 } : {}) };
      }
      return { body: new ReadableStream(), size: SIZE, httpEtag: '"e"', range };
    },
  } as unknown as R2Bucket;
}

const request = (range?: string) =>
  new Request('https://lectio.test/music/x.mp3', range ? { headers: { Range: range } } : undefined);

describe('resolveRange', () => {
  it('clamps offset, open-ended, and suffix ranges to the object', () => {
    expect(resolveRange({ offset: 10, length: 5 }, SIZE)).toEqual({ offset: 10, length: 5 });
    expect(resolveRange({ offset: 990 }, SIZE)).toEqual({ offset: 990, length: 10 });
    expect(resolveRange({ suffix: 100 }, SIZE)).toEqual({ offset: 900, length: 100 });
    expect(resolveRange({ suffix: 5000 }, SIZE)).toEqual({ offset: 0, length: SIZE });
  });
});

describe('serveR2Audio', () => {
  it('serves the whole clip with 200 and advertises range support', async () => {
    const res = await serveR2Audio(bucket(), 'music/x.mp3', request(), 'public');
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe('1000');
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toBe('public');
  });

  it('answers a Range request with 206 and the matching Content-Range', async () => {
    const res = await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=0-1'), 'public');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1/1000');
    expect(res.headers.get('Content-Length')).toBe('2');
  });

  it('answers open-ended and suffix ranges', async () => {
    const open = await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=500-'), 'public');
    expect(open.headers.get('Content-Range')).toBe('bytes 500-999/1000');
    const suffix = await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=-200'), 'public');
    expect(suffix.headers.get('Content-Range')).toBe('bytes 800-999/1000');
  });

  it('returns 416 for an unsatisfiable range and 404 for a missing object', async () => {
    expect((await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=5000-'), 'public')).status).toBe(416);
    expect((await serveR2Audio(bucket(), 'music/missing.mp3', request(), 'public')).status).toBe(404);
  });
});
