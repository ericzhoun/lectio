// Streams an mp3 out of R2 with HTTP Range support. Browsers fetch <audio>
// with Range requests and Safari refuses to play (and every browser refuses to
// seek) a source that never answers 206, so a plain 200 stream is not enough.
import type { R2Bucket, R2Range } from '@cloudflare/workers-types';

/**
 * A single-range "bytes=" header as an R2 range, or undefined when absent or
 * not something we serve partially (multi-range, other units, garbage) - the
 * caller then sends the whole clip, which RFC 9110 allows. We parse it
 * ourselves rather than handing R2 the raw headers, because the range object
 * R2 echoes back does not reliably say which form it took.
 */
export function parseRange(header: string | null): R2Range | undefined {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return undefined;
  const [, from, to] = match;
  if (from === '' && to === '') return undefined;
  if (from === '') return { suffix: Number(to) };
  if (to === '') return { offset: Number(from) };
  if (Number(to) < Number(from)) return undefined;
  return { offset: Number(from), length: Number(to) - Number(from) + 1 };
}

/** The byte window a range resolves to, clamped to the object size. */
export function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
  if ('suffix' in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = 'offset' in range && range.offset !== undefined ? range.offset : 0;
  const wanted = 'length' in range && range.length !== undefined ? range.length : size - offset;
  return { offset, length: Math.min(wanted, size - offset) };
}

export async function serveR2Audio(
  bucket: R2Bucket,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const range = parseRange(request.headers.get('Range'));
  let object;
  try {
    object = await bucket.get(key, range ? { range } : undefined);
  } catch {
    // R2 rejects a range it cannot satisfy instead of returning an object.
    return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes' } });
  }
  if (!object || !('body' in object)) return new Response(null, { status: 404 });

  const headers = new Headers({
    'Content-Type': 'audio/mpeg',
    'Cache-Control': cacheControl,
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
  });
  // R2's stream is typed by workers-types; Response here is the DOM one.
  const body = object.body as unknown as ReadableStream;
  if (range) {
    const { offset, length } = resolveRange(range, object.size);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(body, { headers });
}
