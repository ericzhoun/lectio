import { describe, expect, it } from 'vitest';
import { hasPrebuiltDayAudio, prebuiltDayAudioUrl, stepAudioUrl } from '../audio';

describe('prebuilt audio lookups', () => {
  it('finds the twelve prebuilt step clips from the committed manifest', () => {
    for (const step of ['silencio', 'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio'] as const) {
      for (const lang of ['en', 'zh'] as const) {
        expect(stepAudioUrl(lang, step)).toMatch(new RegExp(`^/audio/steps/${lang}/${step}-[0-9a-f]{8}\\.mp3$`));
      }
    }
  });

  it('returns null for an unknown step', () => {
    expect(stepAudioUrl('en', 'amen' as never)).toBeNull();
  });

  it('does not claim day audio the manifest does not list', () => {
    expect(hasPrebuiltDayAudio('1999-01-01', 'en')).toBe(false);
  });

  it('builds the static URL for a day it does list', () => {
    expect(prebuiltDayAudioUrl('zh', '2026-09-05')).toBe('/audio/days/zh/2026-09-05.mp3');
  });
});
