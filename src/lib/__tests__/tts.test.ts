import { describe, expect, it } from 'vitest';
import {
  decodeTtsAudio, resolveTtsLang, sanitizeTtsText, synthesizeSpeech, TTS_MODEL, TTS_TEXT_MAX_CHARS,
} from '../tts';

describe('resolveTtsLang', () => {
  it('maps zh to zh', () => {
    expect(resolveTtsLang('zh')).toBe('zh');
  });
  it('defaults anything else to en', () => {
    expect(resolveTtsLang('en')).toBe('en');
    expect(resolveTtsLang(undefined)).toBe('en');
    expect(resolveTtsLang(42)).toBe('en');
  });
});

describe('sanitizeTtsText', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizeTtsText('  In  the\nbeginning  ')).toBe('In the beginning');
  });
  it('rejects empty or non-string input', () => {
    expect(sanitizeTtsText('   ')).toBeNull();
    expect(sanitizeTtsText(null)).toBeNull();
    expect(sanitizeTtsText(123)).toBeNull();
  });
  it('caps the text length', () => {
    expect(sanitizeTtsText('a'.repeat(TTS_TEXT_MAX_CHARS + 500))?.length).toBe(
      TTS_TEXT_MAX_CHARS,
    );
  });
});

describe('TTS_MODEL', () => {
  it('targets the open-source MeloTTS model', () => {
    expect(TTS_MODEL).toBe('@cf/myshell-ai/melotts');
  });
});

describe('decodeTtsAudio', () => {
  it('passes raw bytes straight through', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(decodeTtsAudio(bytes)).toBe(bytes);
  });

  it('decodes the base64 { audio } shape MeloTTS actually returns', () => {
    // 'ID3' - the start of an MP3 tag - as base64.
    expect(Array.from(decodeTtsAudio({ audio: 'SUQz' }))).toEqual([0x49, 0x44, 0x33]);
  });

  it('rejects anything else rather than returning silence', () => {
    expect(() => decodeTtsAudio(null)).toThrow('unexpected tts output shape');
    expect(() => decodeTtsAudio({ audio: 42 })).toThrow('unexpected tts output shape');
  });
});

describe('synthesizeSpeech', () => {
  it('calls the model with prompt/lang and decodes the result', async () => {
    const calls: unknown[] = [];
    const ai = {
      run: async (model: string, input: unknown) => {
        calls.push([model, input]);
        return { audio: 'SUQz' };
      },
    } as unknown as Ai;
    const out = await synthesizeSpeech(ai, 'In the beginning', 'en');
    expect(calls).toEqual([[TTS_MODEL, { prompt: 'In the beginning', lang: 'en' }]]);
    expect(Array.from(out)).toEqual([0x49, 0x44, 0x33]);
  });
});
