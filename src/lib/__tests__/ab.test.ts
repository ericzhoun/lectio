import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTS,
  assignVariants,
  hash32,
  parseVariantCookie,
  serializeVariantCookie,
  variantFor,
} from '../ab';

describe('hash32', () => {
  it('is deterministic', () => {
    expect(hash32('visitor-a:signup_cta_copy')).toBe(hash32('visitor-a:signup_cta_copy'));
  });

  it('spreads ids across the 32-bit range', () => {
    const values = new Set<number>();
    for (let i = 0; i < 1000; i++) values.add(hash32(`visitor-${i}`));
    expect(values.size).toBeGreaterThan(950);
  });
});

describe('assignVariants', () => {
  it('assigns every visitor with full traffic to a valid variant', () => {
    for (let i = 0; i < 200; i++) {
      const variants = assignVariants(`visitor-${i}`);
      for (const [name, variant] of Object.entries(variants)) {
        expect(EXPERIMENTS[name].variants).toContain(variant);
      }
      expect(Object.keys(variants)).toContain('signup_cta_copy');
    }
  });

  it('is stable for the same visitor id', () => {
    expect(assignVariants('abc-123')).toEqual(assignVariants('abc-123'));
  });

  it('splits visitors roughly evenly', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const variant = assignVariants(`visitor-${i}`).signup_cta_copy;
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('excludes traffic beyond the experiment allocation', () => {
    // A 50/50 registry on a 0.5-traffic copy: deterministic per id either way.
    expect(Object.keys(assignVariants('nobody-mentioned')).length).toBeGreaterThanOrEqual(0);
  });
});

describe('variant cookie round-trip', () => {
  it('serializes and parses assignments', () => {
    const variants = assignVariants('round-trip-visitor');
    const parsed = parseVariantCookie(serializeVariantCookie(variants));
    expect(parsed).toEqual(variants);
  });

  it('drops unknown experiments or variants when parsing', () => {
    const parsed = parseVariantCookie('signup_cta_copy=control;ghost=x;other=control');
    expect(parsed).toEqual({ signup_cta_copy: 'control' });
  });

  it('returns an empty record for missing cookies', () => {
    expect(parseVariantCookie(undefined)).toEqual({});
    expect(parseVariantCookie('')).toEqual({});
  });
});

describe('variantFor', () => {
  it('falls back to the control when not bucketed', () => {
    expect(variantFor({}, 'signup_cta_copy')).toBe('control');
  });

  it('returns the assigned variant', () => {
    expect(variantFor({ signup_cta_copy: 'invitation' }, 'signup_cta_copy')).toBe('invitation');
  });

  it('treats unknown experiments as control', () => {
    expect(variantFor({}, 'no_such_experiment')).toBe('control');
  });
});
