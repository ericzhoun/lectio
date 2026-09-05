import { describe, expect, it } from 'vitest';
import {
  chunkTtsText, decodeTtsAudio, resolveTtsLang, sanitizeTtsText, synthesizeSpeech,
  TTS_CHUNK_MAX_CHARS, TTS_MODEL, TTS_TEXT_MAX_CHARS,
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

describe('chunkTtsText', () => {
  it('leaves a short reading in one piece', () => {
    expect(chunkTtsText('In the beginning was the Word.', 100)).toEqual([
      'In the beginning was the Word.',
    ]);
  });

  it('breaks at the end of a sentence, keeping the punctuation', () => {
    expect(chunkTtsText('One two. Three four. Five six.', 22)).toEqual([
      'One two. Three four.',
      'Five six.',
    ]);
  });

  it('falls back to a clause, then a space, when no sentence ends in range', () => {
    expect(chunkTtsText('alpha, beta gamma delta', 14)).toEqual(['alpha,', 'beta gamma', 'delta']);
  });

  it('splits unspaced text on length rather than dropping it', () => {
    expect(chunkTtsText('这是一段没有标点的文字', 4)).toEqual([
      '这是一段', '没有标点', '的文字',
    ]);
  });

  // The bug this replaced: three quarters of the English gospel readings are
  // longer than one chunk, and every one of them was cut off mid-sentence.
  it('never loses a character of a passage-length reading', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Verse number ${i}.`).join(' ');
    const chunks = chunkTtsText(text);
    expect(chunks.every((c) => c.length <= TTS_CHUNK_MAX_CHARS)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toBe(text);
  });
});

describe('synthesizeSpeech over several chunks', () => {
  it('speaks every chunk in order and joins the audio', async () => {
    const prompts: string[] = [];
    const ai = {
      run: async (_model: string, input: { prompt: string }) => {
        prompts.push(input.prompt);
        // One distinct byte per call, so the join order is visible.
        return new Uint8Array([prompts.length]);
      },
    } as unknown as Ai;

    const text = `${'a'.repeat(900)}. ${'b'.repeat(900)}.`;
    const out = await synthesizeSpeech(ai, text, 'en');
    expect(prompts).toHaveLength(2);
    expect(prompts.join(' ')).toBe(text);
    expect(Array.from(out)).toEqual([1, 2]);
  });
});

describe('TTS_TEXT_MAX_CHARS', () => {
  it('leaves room for the longest reading in the lectionary', () => {
    expect(TTS_TEXT_MAX_CHARS).toBeGreaterThan(3814);
  });
});
