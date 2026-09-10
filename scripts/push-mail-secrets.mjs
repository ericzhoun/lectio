// Push Daily Invitation mail secrets from .env to Cloudflare Workers (values via stdin, never printed).
// Usage: node scripts/push-mail-secrets.mjs
//
// The Daily Invitation cron is a SEPARATE Worker (lectio-daily-invitation-cron,
// wrangler.cron.jsonc) from the site Worker (lectio, wrangler.jsonc) - see
// src/worker.ts. Each secret goes only to the Worker(s) whose code actually
// reads it, confirmed by reading src/worker.ts, src/lib/unsubscribe.ts and
// src/pages/api/resend-webhook.ts:
//   RESEND_API_KEY        -> cron only     (src/worker.ts sends the batch)
//   MAIL_TOKEN_SECRET      -> cron AND site (cron signs unsubscribe links,
//                              site's /unsubscribe verifies them - src/lib/
//                              unsubscribe.ts). MUST be the identical value
//                              in both, or every unsubscribe link silently
//                              fails verification.
//   RESEND_WEBHOOK_SECRET  -> site only    (src/pages/api/resend-webhook.ts)
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

const SITE_CONFIG = 'wrangler.jsonc';
const CRON_CONFIG = 'wrangler.cron.jsonc';

// [secret name, list of -c config files to push it to]
const TARGETS = [
  ['RESEND_API_KEY', [CRON_CONFIG]],
  ['MAIL_TOKEN_SECRET', [CRON_CONFIG, SITE_CONFIG]],
  ['RESEND_WEBHOOK_SECRET', [SITE_CONFIG]],
];

let failed = false;

function pushOne(key, value, config) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', key, '-c', config], {
    input: value + '\n',
    encoding: 'utf8',
    shell: true,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const ok = /Success!|updated.*secret/i.test(out) && !/error/i.test(out);
  if (!ok) failed = true;
  console.log(
    `${key} -> ${config}: ${ok ? 'pushed' : 'FAILED - ' + out.split('\n').filter((l) => /error/i.test(l))[0]?.slice(0, 120)}`
  );
}

for (const [key, configs] of TARGETS) {
  if (!env[key]) {
    console.log(`${key}: MISSING in .env, skipped (targets: ${configs.join(', ')})`);
    failed = true;
    continue;
  }
  for (const config of configs) {
    pushOne(key, env[key], config);
  }
}
console.log('done');
// A missing secret or a failed push must break a `&&` deploy chain rather
// than sail through it silently - see FIX 3/FIX 9 in the whole-branch review.
if (failed) process.exit(1);
