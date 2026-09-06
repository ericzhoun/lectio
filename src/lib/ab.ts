// Deterministic, cookie-backed A/B assignment.
//
// A visitor id is minted by middleware and stored in a first-party cookie;
// variant assignment is a pure hash of (visitor id, experiment name), so it
// is stable across requests and devices share nothing (no cross-site data).
// Changing the registry (variants, traffic) automatically re-buckets visitors
// on their next request; that is the intended way to launch a new test.

/** One experiment. Index 0 in `variants` is the control. */
export interface Experiment {
  variants: string[];
  /** Fraction of visitors included, 0..1. Everyone else sees the control. */
  traffic: number;
}

export const EXPERIMENTS: Record<string, Experiment> = {
  // Starter test: does an invitation-shaped signup CTA outperform the plain
  // "sign up" link in the auth card? Variants render in LoginForm.astro.
  signup_cta_copy: {
    variants: ['control', 'invitation'],
    traffic: 1,
  },
};

const MAX_TRAFFIC = 1;

/** FNV-1a, stable across server and tests. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** All experiments the visitor is bucketed into, mapping name -> variant. */
export function assignVariants(visitorId: string): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const [name, experiment] of Object.entries(EXPERIMENTS)) {
    if (experiment.traffic <= 0 || experiment.traffic > MAX_TRAFFIC) continue;
    const included = hash32(`${visitorId}:${name}:include`) / 0x100000000 < experiment.traffic;
    if (!included) continue;
    const index = hash32(`${visitorId}:${name}`) % experiment.variants.length;
    variants[name] = experiment.variants[index];
  }
  return variants;
}

/** Parse the `ab` cookie value (`name=variant;name=variant`). */
export function parseVariantCookie(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const variants: Record<string, string> = {};
  for (const pair of value.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const variant = pair.slice(eq + 1);
    const experiment = EXPERIMENTS[name];
    if (experiment && experiment.variants.includes(variant)) variants[name] = variant;
  }
  return variants;
}

export function serializeVariantCookie(variants: Record<string, string>): string {
  return Object.entries(variants)
    .filter(([name, variant]) => EXPERIMENTS[name]?.variants.includes(variant))
    .map(([name, variant]) => `${name}=${variant}`)
    .join(';');
}

/** The variant a visitor sees for `name`, or the control when not bucketed. */
export function variantFor(variants: Record<string, string>, name: string): string {
  const experiment = EXPERIMENTS[name];
  if (!experiment) return 'control';
  return variants[name] ?? experiment.variants[0];
}
