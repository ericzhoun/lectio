import { describe, it, expect } from 'vitest';
import {
  STEP_ORDER, WRITING_STEPS, STEP_COPY, isStep, stepIndex, nextStep, progressPercent,
} from '../dailySteps';

describe('step order', () => {
  it('runs the six movements in order', () => {
    expect(STEP_ORDER).toEqual([
      'silencio', 'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
    ]);
  });

  it('takes writing at exactly three steps, and never at contemplatio', () => {
    expect(WRITING_STEPS).toEqual(['meditatio', 'oratio', 'actio']);
    expect(WRITING_STEPS).not.toContain('contemplatio');
  });
});

describe('isStep', () => {
  it('accepts a step and rejects anything else', () => {
    expect(isStep('oratio')).toBe(true);
    expect(isStep('amen')).toBe(false);
    expect(isStep(null)).toBe(false);
  });
});

describe('nextStep', () => {
  it('advances through the list and ends at null', () => {
    expect(nextStep('silencio')).toBe('lectio');
    expect(nextStep('contemplatio')).toBe('actio');
    expect(nextStep('actio')).toBeNull();
  });
});

describe('progressPercent', () => {
  it('starts above zero and ends at one hundred', () => {
    expect(progressPercent('silencio')).toBe(17);
    expect(progressPercent('actio')).toBe(100);
  });
});

describe('STEP_COPY', () => {
  it('has a name and prompt in both languages for every step', () => {
    for (const step of STEP_ORDER) {
      expect(STEP_COPY[step].name.en, step).toBeTruthy();
      expect(STEP_COPY[step].name.zh, step).toBeTruthy();
      expect(STEP_COPY[step].prompt.en, step).toBeTruthy();
      expect(STEP_COPY[step].prompt.zh, step).toBeTruthy();
    }
  });
});
