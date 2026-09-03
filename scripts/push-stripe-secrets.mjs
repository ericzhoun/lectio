// Push Stripe secrets from .env to Cloudflare Workers (values via stdin, never printed).
// Usage: node scripts/push-stripe-secrets.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
      (t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return t.slice(1, -1);
  return t.trim();
};

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0) env[t.slice(0, eq).trim()] = unquote(t.slice(eq + 1));
}

const keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_BASIC', 'STRIPE_PRICE_PRO'];

// Guard: refuse to push an unfilled placeholder or a test key into production.
const sk = env.STRIPE_SECRET_KEY ?? '';
if (!sk || sk === 'PASTE_LIVE_SK_HERE') {
  console.error('STRIPE_SECRET_KEY is missing or still the placeholder in .env. Aborting.');
  process.exit(1);
}
if (!sk.startsWith('sk_live_') && !sk.startsWith('rk_live_')) {
  console.error('STRIPE_SECRET_KEY is not a live key (expected sk_live_/rk_live_ prefix). Aborting.');
  process.exit(1);
}

for (const k of keys) {
  if (!env[k]) {
    console.log(`${k}: MISSING in .env, skipped`);
    continue;
  }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', k], {
    input: env[k] + '\n',
    encoding: 'utf8',
    shell: true,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const ok = /Success!|updated.*secret/i.test(out) && !/error/i.test(out);
  console.log(`${k}: ${ok ? 'pushed to production' : 'FAILED - ' + out.split('\n').filter((l) => /error/i.test(l))[0]?.slice(0, 120)}`);
}
console.log('done');
