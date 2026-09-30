import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPERIMENTS,
  assignVariants,
  hash32,
  parseVariantCookie,
  serializeVariantCookie,
  variantFor,
  type Experiment,
} from '../ab';

// No experiment ships in the registry right now (signup_cta_copy was retired
// in September 2026 without a verdict), so the mechanism tests register a
// fixture for themselves. EXPERIMENTS is a plain record and assignment is
// pure, so this tests exactly what middleware runs with a live registry.
const FIXTURE: Experiment = { variants: ['control', 'invitation'], traffic: 1 };
const FIXTURE_NAME = 'test_experiment';

afterEach(() => {
  delete EXPERIMENTS[FIXTURE_NAME];
});

describe('hash32', () => {
  it('is deterministic', () => {
    expect(hash32('visitor-a:test_experiment')).toBe(hash32('visitor-a:test_experiment'));
  });

  it('spreads ids across the 32-bit range', () => {
    const values = new Set<number>();
    for (let i = 0; i < 1000; i++) values.add(hash32(`visitor-${i}`));
    expect(values.size).toBeGreaterThan(950);
  });
});

describe('assignVariants', () => {
  it('assigns every visitor with full traffic to a valid variant', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    for (let i = 0; i < 200; i++) {
      const variants = assignVariants(`visitor-${i}`);
      for (const [name, variant] of Object.entries(variants)) {
        expect(EXPERIMENTS[name].variants).toContain(variant);
      }
      expect(Object.keys(variants)).toContain(FIXTURE_NAME);
    }
  });

  it('is stable for the same visitor id', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    expect(assignVariants('abc-123')).toEqual(assignVariants('abc-123'));
  });

  it('splits visitors roughly evenly', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const variant = assignVariants(`visitor-${i}`)[FIXTURE_NAME]!;
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('leaves visitors out past the traffic allocation', () => {
    EXPERIMENTS[FIXTURE_NAME] = { variants: FIXTURE.variants, traffic: 0.001 };
    const assigned = Array.from({ length: 500 }, (_, i) => assignVariants(`visitor-${i}`));
    const included = assigned.filter((v) => FIXTURE_NAME in v).length;
    expect(included).toBeLessThan(50);
    expect(included).toBeGreaterThan(0);
  });

  it('returns nothing when the registry is empty', () => {
    expect(assignVariants('anyone')).toEqual({});
  });
});

describe('variant cookie round-trip', () => {
  it('serializes and parses assignments', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    const variants = assignVariants('round-trip-visitor');
    const parsed = parseVariantCookie(serializeVariantCookie(variants));
    expect(parsed).toEqual(variants);
  });

  it('drops unknown experiments or variants when parsing', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    const parsed = parseVariantCookie(`${FIXTURE_NAME}=control;ghost=x;other=control`);
    expect(parsed).toEqual({ [FIXTURE_NAME]: 'control' });
  });

  it('returns an empty record for missing cookies', () => {
    expect(parseVariantCookie(undefined)).toEqual({});
    expect(parseVariantCookie('')).toEqual({});
  });
});

describe('variantFor', () => {
  it('falls back to the control when not bucketed', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    expect(variantFor({}, FIXTURE_NAME)).toBe('control');
  });

  it('returns the assigned variant', () => {
    EXPERIMENTS[FIXTURE_NAME] = FIXTURE;
    expect(variantFor({ [FIXTURE_NAME]: 'invitation' }, FIXTURE_NAME)).toBe('invitation');
  });

  it('treats unknown experiments as control', () => {
    expect(variantFor({}, 'no_such_experiment')).toBe('control');
  });
});
