// Swap local dev vars: .env (real Google credentials) -> .dev.vars, keeping SESSION_SECRET.
// Strips surrounding quotes; never prints secret values.
import fs from 'node:fs';

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
      (t.startsWith('"') && t.endsWith('"') && t.length >= 2)) {
    return t.slice(1, -1);
  }
  return t;
};

const parse = (file) => {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq).trim()] = unquote(t.slice(eq + 1));
  }
  return out;
};

const env = parse('.env');
const oldVars = parse('.dev.vars.mock-bak');
const bak = '.dev.vars.mock-bak';

if (!fs.existsSync(bak)) {
  if (!fs.existsSync('.dev.vars')) {
    console.error('FATAL: neither .dev.vars nor backup exists');
    process.exit(1);
  }
  fs.copyFileSync('.dev.vars', bak);
  console.log('backed up .dev.vars ->', bak);
} else {
  console.log('backup already exists, keeping original mock backup');
}

if (!oldVars.SESSION_SECRET) {
  console.error('FATAL: no SESSION_SECRET in backup');
  process.exit(1);
}

const lines = [`SESSION_SECRET=${oldVars.SESSION_SECRET}`];
for (const k of [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_AUTH_URL',
  'GOOGLE_TOKEN_URL',
  'GOOGLE_USERINFO_URL',
]) {
  if (env[k]) lines.push(`${k}=${env[k]}`);
}
fs.writeFileSync('.dev.vars', lines.join('\n') + '\n');
console.log('wrote .dev.vars with keys:', lines.map((l) => l.split('=')[0]).join(', '));
const rid = env.GOOGLE_REDIRECT_URI ?? '(derived from request origin)';
console.log('redirect_uri in use:', rid);
console.log('client_id prefix:', (env.GOOGLE_CLIENT_ID ?? '?').slice(0, 20) + '...');
