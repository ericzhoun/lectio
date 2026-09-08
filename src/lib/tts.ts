// Speech synthesis for the daily passage.
//
// English goes through the open-source MeloTTS model (@cf/myshell-ai/melotts)
// on Cloudflare Workers AI, which is free with the AI binding. Chinese cannot:
// MeloTTS on Workers AI produces noise for Chinese text whatever `lang` says -
// an ASR round-trip of 神爱世人 comes back as "ankh ankh ankh ankh" - and no
// other Workers AI voice speaks it. So Chinese uses OpenAI's gpt-4o-mini-tts,
// the same model, voice and delivery instructions the prebuilt clips are cut
// with in scripts/tts/lib.mts. Prebuilt clips still win wherever they exist;
// this is only the fallback for a day that has none.

/** What MeloTTS will accept in a single call. */
export const TTS_CHUNK_MAX_CHARS = 1000;

/** Comfortably inside the 4096-character input limit on OpenAI speech. */
export const TTS_OPENAI_CHUNK_MAX_CHARS = 3000;

/**
 * The whole reading's ceiling, across however many calls it takes. Most of the
 * lectionary's English gospel readings run past a single chunk - the median is
 * around 1300 characters and the longest is under 4000 - so this is a guard
 * against a runaway, not the length of a normal passage.
 */
export const TTS_TEXT_MAX_CHARS = 6000;

export type TtsLang = 'en' | 'zh';

/** Synthesized speech, with the media type it is actually in. */
export interface TtsAudio {
  bytes: Uint8Array;
  contentType: string;
}

export function resolveTtsLang(raw: unknown): TtsLang {
  return raw === 'zh' ? 'zh' : 'en';
}

/** Collapse whitespace and hard-cap the text the model receives. */
export function sanitizeTtsText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, TTS_TEXT_MAX_CHARS);
}

export const TTS_MODEL = '@cf/myshell-ai/melotts';

export const TTS_OPENAI_MODEL = 'gpt-4o-mini-tts';
export const TTS_OPENAI_VOICE = 'shimmer';

/** Kept in step with scripts/tts/lib.mts, so the fallback sounds like the clips. */
const TTS_OPENAI_INSTRUCTIONS =
  'Speak slowly, calmly and reverently, like a quiet retreat guide reading scripture. ' +
  '咬字清晰，语速平缓，庄重安详。';

/**
 * Workers AI returns speech either as raw bytes or as base64 in `{ audio }`,
 * and MeloTTS in practice returns the latter. The union is declared in the
 * Workers types, so handling only one branch type-checks and still fails at
 * runtime - which is exactly how this went wrong the first time.
 */
export function decodeTtsAudio(out: unknown): Uint8Array {
  if (out instanceof Uint8Array) return out;
  if (out && typeof out === 'object' && typeof (out as { audio?: unknown }).audio === 'string') {
    const binary = atob((out as { audio: string }).audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new Error('unexpected tts output shape');
}

/**
 * Where a chunk may end, in descending order of how natural the break sounds.
 * Each pattern swallows any closing quote or bracket that belongs to the
 * sentence it ends, so scripture's quoted speech does not strand a lone '”'
 * at the head of the next chunk.
 */
const CHUNK_BOUNDARIES = [
  /[.!?。！？][”’"')\]」』]*\s*/g,
  /[,;:，；：、][”’"')\]」』]*\s*/g,
  /\s+/g,
];

/** The end of the last usable break in `window`, or 0 if it holds none. */
function lastBoundary(window: string): number {
  for (const pattern of CHUNK_BOUNDARIES) {
    let end = 0;
    for (const match of window.matchAll(pattern)) end = match.index + match[0].length;
    if (end > 0) return end;
  }
  return 0;
}

/**
 * Split a reading into pieces the model will accept, preferring to break where
 * a reader would draw breath: at the end of a sentence, then at a clause, then
 * at a space. A run of text with none of those - unspaced Chinese, mostly - is
 * split on length, because a hard break is still better than a missing verse.
 */
export function chunkTtsText(text: string, max = TTS_CHUNK_MAX_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = lastBoundary(rest.slice(0, max)) || max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

const ascii = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Whether these bytes open with a RIFF/WAVE header. */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WAVE';
}

/** The [start, end) of the PCM payload, or null if the file has no data chunk. */
function wavDataRange(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (ascii(bytes, at) === 'data') return [body, Math.min(body + size, bytes.length)];
    at = body + size + (size % 2);
  }
  return null;
}

/**
 * Join several WAV files into one playable file.
 *
 * MeloTTS returns WAV, not the MP3 its Workers AI schema advertises, so plain
 * byte-concatenation produced a file whose header described only the first
 * call: players stopped there, and every reading longer than one chunk lost
 * its tail with nothing to show for it. Here the payloads are joined and the
 * first file's header is rewritten to cover all of them.
 */
export function concatWav(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  if (!parts.every(isWav)) return concatBytes(parts);
  const ranges = parts.map(wavDataRange);
  if (ranges.some((r) => r === null)) return concatBytes(parts);

  const firstStart = (ranges[0] as [number, number])[0];
  const header = parts[0].subarray(0, firstStart);
  const payloads = parts.map((part, i) => {
    const [start, end] = ranges[i] as [number, number];
    return part.subarray(start, end);
  });
  const dataSize = payloads.reduce((n, p) => n + p.length, 0);

  const joined = new Uint8Array(header.length + dataSize);
  joined.set(header, 0);
  let at = header.length;
  for (const payload of payloads) {
    joined.set(payload, at);
    at += payload.length;
  }
  const view = new DataView(joined.buffer);
  view.setUint32(4, joined.length - 8, true); // RIFF chunk size
  view.setUint32(firstStart - 4, dataSize, true); // data chunk size
  return joined;
}

/** English, on Workers AI. Free with the binding, and it answers in WAV. */
async function synthesizeEnglish(ai: Ai, text: string): Promise<TtsAudio> {
  const parts: Uint8Array[] = [];
  for (const chunk of chunkTtsText(text)) {
    parts.push(decodeTtsAudio(await ai.run(TTS_MODEL, { prompt: chunk, lang: 'en' })));
  }
  if (!parts.length) throw new Error('nothing to speak');
  const bytes = concatWav(parts);
  return { bytes, contentType: isWav(bytes) ? 'audio/wav' : 'audio/mpeg' };
}

/**
 * Chinese, on OpenAI. MP3 frames concatenate cleanly, so a reading longer than
 * one call still comes back as a single file players read end to end.
 */
async function synthesizeChinese(text: string): Promise<TtsAudio> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const parts: Uint8Array[] = [];
  for (const chunk of chunkTtsText(text, TTS_OPENAI_CHUNK_MAX_CHARS)) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_OPENAI_MODEL,
        voice: TTS_OPENAI_VOICE,
        input: chunk,
        instructions: TTS_OPENAI_INSTRUCTIONS,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      throw new Error(`openai tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  if (!parts.length) throw new Error('nothing to speak');
  return { bytes: concatBytes(parts), contentType: 'audio/mpeg' };
}

/** Speak the whole text, in as many model calls as its length demands. */
export async function synthesizeSpeech(
  ai: Ai,
  text: string,
  lang: TtsLang,
): Promise<TtsAudio> {
  return lang === 'zh' ? synthesizeChinese(text) : synthesizeEnglish(ai, text);
}
