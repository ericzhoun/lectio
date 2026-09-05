// Speech synthesis for the daily passage, via the open-source MeloTTS
// model (@cf/myshell-ai/melotts) on Cloudflare Workers AI.

export const TTS_TEXT_MAX_CHARS = 1000;

export type TtsLang = 'en' | 'zh';

export function resolveTtsLang(raw: unknown): TtsLang {
  return raw === 'zh' ? 'zh' : 'en';
}

/** Strip references/citation noise and hard-cap the text the model receives. */
export function sanitizeTtsText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, TTS_TEXT_MAX_CHARS);
}

export const TTS_MODEL = '@cf/myshell-ai/melotts';

export async function synthesizeSpeech(
  ai: Ai,
  text: string,
  lang: TtsLang,
): Promise<Uint8Array> {
  const out = await ai.run(TTS_MODEL, { prompt: text, lang });
  if (out instanceof Uint8Array) return out;
  throw new Error('unexpected tts output shape');
}
