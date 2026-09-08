import { describe, expect, it, vi } from 'vitest';
import {
  chunkTtsText, concatWav, decodeTtsAudio, isWav, resolveTtsLang, sanitizeTtsText,
  synthesizeSpeech, TTS_CHUNK_MAX_CHARS, TTS_MODEL, TTS_OPENAI_CHUNK_MAX_CHARS,
  TTS_OPENAI_MODEL, TTS_TEXT_MAX_CHARS,
} from '../tts';

/** A minimal but real WAV file carrying `payload` as its data chunk. */
function wav(payload: number[]): Uint8Array {
  const bytes = new Uint8Array(44 + payload.length);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  tag(36, 'data');
  view.setUint32(40, payload.length, true);
  bytes.set(payload, 44);
  return bytes;
}

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
    expect(Array.from(out.bytes)).toEqual([0x49, 0x44, 0x33]);
  });
});

describe('isWav', () => {
  it('recognizes what MeloTTS actually returns, whatever its schema says', () => {
    expect(isWav(wav([1, 2, 3]))).toBe(true);
    expect(isWav(new Uint8Array([0x49, 0x44, 0x33]))).toBe(false);
    expect(isWav(new Uint8Array())).toBe(false);
  });
});

describe('concatWav', () => {
  // The bug: byte-concatenating two WAVs leaves a header describing only the
  // first, so players stopped there and the rest of the reading was lost.
  it('joins payloads under one header that covers all of them', () => {
    const joined = concatWav([wav([1, 2, 3]), wav([4, 5]), wav([6])]);
    const view = new DataView(joined.buffer);
    expect(joined.length).toBe(44 + 6);
    expect(view.getUint32(4, true)).toBe(joined.length - 8);
    expect(view.getUint32(40, true)).toBe(6);
    expect(Array.from(joined.subarray(44))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(joined.indexOf(0x52, 4)).toBe(-1); // no second 'RIFF' mid-stream
  });

  it('leaves a single file untouched', () => {
    const only = wav([7, 8]);
    expect(concatWav([only])).toBe(only);
  });

  it('falls back to plain concatenation for non-WAV parts', () => {
    const out = concatWav([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe('synthesizeSpeech in Chinese', () => {
  // MeloTTS on Workers AI answers Chinese with noise - an ASR round-trip of
  // 神爱世人 comes back as 'ankh ankh ankh' - so Chinese must not reach it.
  const okResponse = () => new Response(new Uint8Array([0xff, 0xfb, 0x90]));

  it('goes to OpenAI, never to Workers AI', async () => {
    const ai = { run: async () => { throw new Error('melotts must not speak Chinese'); } } as unknown as Ai;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENAI_API_KEY = 'sk-test';

    const out = await synthesizeSpeech(ai, '神爱世人', 'zh');
    expect(out.contentType).toBe('audio/mpeg');
    expect(Array.from(out.bytes)).toEqual([0xff, 0xfb, 0x90]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(TTS_OPENAI_MODEL);
    expect(body.input).toBe('神爱世人');
    expect(body.response_format).toBe('mp3');
    vi.unstubAllGlobals();
  });

  it('chunks past the OpenAI input limit and joins the frames in order', async () => {
    const ai = { run: async () => { throw new Error('unused'); } } as unknown as Ai;
    let n = 0;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(new Uint8Array([++n])));
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENAI_API_KEY = 'sk-test';

    const text = `${'甲'.repeat(TTS_OPENAI_CHUNK_MAX_CHARS)}。${'乙'.repeat(200)}`;
    const out = await synthesizeSpeech(ai, text, 'zh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Array.from(out.bytes)).toEqual([1, 2]);
    vi.unstubAllGlobals();
  });

  it('surfaces an OpenAI failure rather than returning a broken file', async () => {
    const ai = { run: async () => { throw new Error('unused'); } } as unknown as Ai;
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 429 }));
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(synthesizeSpeech(ai, '神爱世人', 'zh')).rejects.toThrow('openai tts 429');
    vi.unstubAllGlobals();
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
    expect(Array.from(out.bytes)).toEqual([1, 2]);
  });
});

describe('TTS_TEXT_MAX_CHARS', () => {
  it('leaves room for the longest reading in the lectionary', () => {
    expect(TTS_TEXT_MAX_CHARS).toBeGreaterThan(3814);
  });
});
