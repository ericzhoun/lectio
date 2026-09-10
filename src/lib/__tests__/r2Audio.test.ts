import { describe, expect, it } from 'vitest';
import type { R2Bucket, R2Range } from '@cloudflare/workers-types';
import { parseRange, resolveRange, serveR2Audio } from '../r2Audio';

const SIZE = 1000;

/**
 * A bucket holding one object. Like real R2, it echoes back a range object
 * that carries every field, unset ones as undefined - the shape that once
 * produced "bytes NaN-NaN" in production.
 */
function bucket(): R2Bucket {
  return {
    get: async (key: string, options?: { range?: R2Range }) => {
      if (key !== 'music/x.mp3') return null;
      const r = options?.range as { offset?: number; length?: number; suffix?: number } | undefined;
      if (r?.offset !== undefined && r.offset >= SIZE) throw new Error('InvalidRange');
      const range = r ? { offset: r.offset, length: r.length, suffix: r.suffix } : undefined;
      return { body: new ReadableStream(), size: SIZE, httpEtag: '"e"', range };
    },
  } as unknown as R2Bucket;
}

const request = (range?: string) =>
  new Request('https://lectio.test/music/x.mp3', range ? { headers: { Range: range } } : undefined);

describe('parseRange', () => {
  it('parses closed, open-ended, and suffix byte ranges', () => {
    expect(parseRange('bytes=0-1')).toEqual({ offset: 0, length: 2 });
    expect(parseRange('bytes=500-')).toEqual({ offset: 500 });
    expect(parseRange('bytes=-200')).toEqual({ suffix: 200 });
  });

  it('ignores absent, multi-range, reversed, and malformed headers', () => {
    for (const header of [null, '', 'bytes=-', 'bytes=0-1,5-9', 'bytes=9-1', 'items=0-1', 'bytes=a-b']) {
      expect(parseRange(header)).toBeUndefined();
    }
  });
});

describe('resolveRange', () => {
  it('clamps offset, open-ended, and suffix ranges to the object', () => {
    expect(resolveRange({ offset: 10, length: 5 }, SIZE)).toEqual({ offset: 10, length: 5 });
    expect(resolveRange({ offset: 990 }, SIZE)).toEqual({ offset: 990, length: 10 });
    expect(resolveRange({ offset: 990, length: 500 }, SIZE)).toEqual({ offset: 990, length: 10 });
    expect(resolveRange({ suffix: 100 }, SIZE)).toEqual({ offset: 900, length: 100 });
    expect(resolveRange({ suffix: 5000 }, SIZE)).toEqual({ offset: 0, length: SIZE });
  });

  it('treats an undefined suffix field as an offset range', () => {
    expect(resolveRange({ offset: 0, length: 2, suffix: undefined } as unknown as R2Range, SIZE))
      .toEqual({ offset: 0, length: 2 });
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

  it('serves the whole clip for a Range header it does not handle', async () => {
    const res = await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=0-1,5-9'), 'public');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
  });

  it('returns 416 for an unsatisfiable range and 404 for a missing object', async () => {
    expect((await serveR2Audio(bucket(), 'music/x.mp3', request('bytes=5000-'), 'public')).status).toBe(416);
    expect((await serveR2Audio(bucket(), 'music/missing.mp3', request(), 'public')).status).toBe(404);
  });
});
