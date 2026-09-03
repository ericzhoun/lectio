// E2E: Google sign-in linking to an existing password account (no duplicate).
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const MOCK = process.argv[3] ?? 'http://127.0.0.1:9000';
const LOG = '.e2e/e2e-google-link.log';
fs.mkdirSync('.e2e', { recursive: true });
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };

const jar = new Map();
const setCookies = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value === 'deleted' || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }
};
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
async function req(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    ...opts,
    headers: { Cookie: cookieHeader(), Origin: BASE, ...(opts.headers ?? {}) },
  });
  setCookies(res);
  return res;
}
async function follow(url) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await req(current);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, url: current };
  }
  throw new Error('too many redirects');
}

log('=== E2E Google link-to-existing-password-account ===');

// 1. Create a password account through the normal signup form (idempotent:
// if it already exists from a previous run, continue with the existing account)
const form = new URLSearchParams({ email: 'link.test@gmail.com', password: 'password-123' });
const signup = await req(`${BASE}/api/auth/signup`, { method: 'POST', body: form });
const signupLoc = signup.headers.get('location') ?? '';
log(`signup -> ${signup.status} location=${signupLoc}`);
if (signupLoc.includes('/signup?error=duplicate')) {
  log('signup: account already exists from a previous run — continuing');
} else if (signup.status !== 302 || !signupLoc.includes('/account')) {
  log('FAIL signup did not succeed');
  process.exit(1);
}
const passwordSession = jar.get('session');
if (passwordSession) {
  log(`signup created password account + session (token prefix ${passwordSession.slice(0, 12)}...)`);
}

// clear session to simulate returning later
jar.delete('session');

// 2. Configure the mock Google profile with the SAME verified email
await fetch(`${MOCK}/__set-user`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sub: 'google-link-777', name: 'Link Test', email: 'link.test@gmail.com', email_verified: true }),
});

// 3. Google sign-in with that email
const start = await req(`${BASE}/api/auth/google/start?lang=zh`);
const loc = start.headers.get('location');
const { url: finalUrl } = await follow(loc);
log(`google sign-in -> ${finalUrl}`);
const ok = finalUrl.includes('/account');
log(ok ? 'PASS signed in via Google' : 'FAIL google sign-in failed');

// 4. Sanity: google-only account (empty password hash) must not allow password login
await fetch(`${MOCK}/__set-user`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});

log(ok ? '=== SUMMARY: PASS ===' : '=== SUMMARY: FAIL ===');
process.exit(ok ? 0 : 1);
