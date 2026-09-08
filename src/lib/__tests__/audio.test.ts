import { describe, expect, it } from 'vitest';
import { audioR2Key } from '../audio';

describe('audioR2Key', () => {
  it('maps a manifest step clip to its R2 key', () => {
    expect(audioR2Key('/audio/steps/en/silencio-45d02d30.mp3')).toBe(
      'steps/en/silencio-45d02d30.mp3',
    );
  });

  it('maps a manifest day clip to its R2 key', () => {
    expect(audioR2Key('/audio/days/en/2026-01-01.mp3')).toBe('days/en/2026-01-01.mp3');
  });

  it('rejects URLs that are not manifest-listed clips', () => {
    expect(audioR2Key('/audio/unknown/en/x.mp3')).toBeNull();
    expect(audioR2Key('/audio/days/en/1999-01-01.mp3')).toBeNull();
    expect(audioR2Key('/audio/steps/en/not-a-clip.mp3')).toBeNull();
    expect(audioR2Key('/audio/days/en/2026-01-01.m3u')).toBeNull();
  });

  it('never resolves traversal or malformed paths', () => {
    expect(audioR2Key('/audio/../secret.mp3')).toBeNull();
    expect(audioR2Key('/audio//days/en/2026-01-01.mp3')).toBeNull();
    expect(audioR2Key('audio/days/en/2026-01-01.mp3')).toBeNull();
    expect(audioR2Key('')).toBeNull();
  });
});
