import { describe, expect, it } from 'vitest';
import { resolveTtsLang, sanitizeTtsText, TTS_MODEL, TTS_TEXT_MAX_CHARS } from '../tts';

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
