import { describe, it, expect } from 'vitest';
import {
  STEP_ORDER, WRITING_STEPS, STEP_COPY, isStep, stepIndex, nextStep, progressPercent,
} from '../dailySteps';

describe('step order', () => {
  it('runs the five movements in order, opening at lectio', () => {
    expect(STEP_ORDER).toEqual([
      'lectio', 'meditatio', 'oratio', 'contemplatio', 'actio',
    ]);
  });

  it('no longer carries silencio', () => {
    expect(STEP_ORDER).not.toContain('silencio');
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
    expect(nextStep('lectio')).toBe('meditatio');
    expect(nextStep('contemplatio')).toBe('actio');
    expect(nextStep('actio')).toBeNull();
  });
});

describe('progressPercent', () => {
  it('starts above zero and ends at one hundred', () => {
    expect(progressPercent('lectio')).toBe(20);
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

  it('estimates a positive duration for every step', () => {
    for (const step of STEP_ORDER) {
      expect(STEP_COPY[step].minutes, step).toBeGreaterThan(0);
    }
  });
});
