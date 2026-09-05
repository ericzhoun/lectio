// Speech synthesis for the daily passage, via the open-source MeloTTS
// model (@cf/myshell-ai/melotts) on Cloudflare Workers AI.

/** What MeloTTS will accept in a single call. */
export const TTS_CHUNK_MAX_CHARS = 1000;

/**
 * The whole reading's ceiling, across however many calls it takes. Most of the
 * lectionary's English gospel readings run past a single chunk - the median is
 * around 1300 characters and the longest is under 4000 - so this is a guard
 * against a runaway, not the length of a normal passage.
 */
export const TTS_TEXT_MAX_CHARS = 6000;

export type TtsLang = 'en' | 'zh';

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

function concatAudio(parts: Uint8Array[]): Uint8Array {
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

/**
 * Speak the whole text, in as many model calls as its length demands. The MP3
 * frames are concatenated in order; players read the result as one file.
 */
export async function synthesizeSpeech(
  ai: Ai,
  text: string,
  lang: TtsLang,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const chunk of chunkTtsText(text)) {
    parts.push(decodeTtsAudio(await ai.run(TTS_MODEL, { prompt: chunk, lang })));
  }
  if (!parts.length) throw new Error('nothing to speak');
  return concatAudio(parts);
}
