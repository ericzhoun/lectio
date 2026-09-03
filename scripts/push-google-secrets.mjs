// Push Google OAuth secrets from .env to Cloudflare Workers (values via stdin, never printed)
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

const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
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
  console.log(`${k}: ${ok ? 'pushed to production' : 'FAILED — ' + out.split('\n').filter((l) => /error/i.test(l))[0]?.slice(0, 120)}`);
}
console.log('done');
