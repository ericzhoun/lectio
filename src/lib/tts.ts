// Speech synthesis for the daily passage, via the open-source MeloTTS
// model (@cf/myshell-ai/melotts) on Cloudflare Workers AI.

/**
 * MeloTTS rejects very long inputs. The daily focus passage fits comfortably;
 * the cap is a guard against a pathologically long reading, not a feature.
 */
export const TTS_TEXT_MAX_CHARS = 1000;

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

export async function synthesizeSpeech(
  ai: Ai,
  text: string,
  lang: TtsLang,
): Promise<Uint8Array> {
  return decodeTtsAudio(await ai.run(TTS_MODEL, { prompt: text, lang }));
}
