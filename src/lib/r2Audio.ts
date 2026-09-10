// Streams an mp3 out of R2 with HTTP Range support. Browsers fetch <audio>
// with Range requests and Safari refuses to play (and every browser refuses to
// seek) a source that never answers 206, so a plain 200 stream is not enough.
import type { R2Bucket, R2Range } from '@cloudflare/workers-types';

/** The byte window an R2 range resolved to, clamped to the object size. */
export function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = Math.min(range.length ?? size - offset, size - offset);
  return { offset, length };
}

export async function serveR2Audio(
  bucket: R2Bucket,
  key: string,
  request: Request,
  cacheControl: string,
): Promise<Response> {
  const wantsRange = request.headers.has('Range');
  let object;
  try {
    object = await bucket.get(key, wantsRange ? { range: request.headers as never } : undefined);
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
  if (wantsRange && object.range) {
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(body, { headers });
}
