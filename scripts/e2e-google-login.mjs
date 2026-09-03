// E2E driver for the Google sign-in flow against a locally running app
// (wrangler dev on :8787) with the mock Google IdP (:9000).
// Usage: node scripts/e2e-google-login.mjs [baseUrl] [mockUrl]
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const MOCK = process.argv[3] ?? 'http://localhost:9000';
const LOG_DIR = path.resolve('.e2e');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG = path.join(LOG_DIR, 'e2e-google-login.log');
const log = (line) => {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG, text + '\n');
};

const jar = new Map();
const setCookies = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
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
const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

let failures = 0;
const results = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    log(`PASS ${name}${detail ? ` :: ${detail}` : ''}`);
  } catch (e) {
    failures += 1;
    results.push({ name, ok: false, detail: String(e.message ?? e) });
    log(`FAIL ${name} :: ${e.message ?? e}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function get(pathname) {
  const res = await fetch(BASE + pathname, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
  setCookies(res);
  return res;
}
async function getAbs(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
  setCookies(res);
  return res;
}
/** Follow a redirect chain (manual) and return the final response + URL. */
async function follow(url, hops = 5) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    const res = await getAbs(current);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, url: current };
  }
  throw new Error('too many redirects');
}
async function post(pathname) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookieHeader(), Origin: BASE },
  });
  setCookies(res);
  return res;
}

log(`=== E2E Google login flow (base=${BASE}, mock=${MOCK}) ===`);

// 1. Login page shows the Google entry
await step('login page shows Google entry', async () => {
  const res = await get('/login');
  const html = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  assert(html.includes('/api/auth/google/start'), 'missing google start link');
  assert(/Continue with Google|使用 Google 继续/.test(html), 'missing button text');
  return `status=200, google start link present`;
});

// 2. Signup page shows the Google entry
await step('signup page shows Google entry', async () => {
  const res = await get('/signup');
  const html = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  assert(html.includes('/api/auth/google/start'), 'missing google start link');
  return 'ok';
});

// 3. Start -> redirect to Google auth with state; oauth_state cookie set
await step('start redirects to Google with state + sets cookie', async () => {
  const res = await get('/api/auth/google/start?lang=zh');
  const loc = res.headers.get('location') ?? '';
  assert(res.status === 302, `status ${res.status}`);
  assert(loc.startsWith(MOCK + '/auth?'), `location ${loc}`);
  const u = new URL(loc);
  assert(u.searchParams.get('client_id') === 'mock-client-id', 'client_id missing');
  assert(u.searchParams.get('redirect_uri') === `${BASE}/api/auth/google/callback`, 'redirect_uri wrong');
  assert(u.searchParams.get('response_type') === 'code', 'response_type wrong');
  const state = u.searchParams.get('state');
  assert(state && state.length >= 30, 'state missing/short');
  assert(jar.has('oauth_state') && jar.get('oauth_state') === state, 'oauth_state cookie mismatch');
  return `state=${state.slice(0, 12)}…`;
});

// 4. Full first-time registration via mock consent
// (accepts both fresh-registration welcome redirect and repeat-signin redirect)
let sessionToken = '';
await step('first sign-in registers and lands on /account', async () => {
  const start = await get('/api/auth/google/start?lang=zh');
  const loc = start.headers.get('location') ?? '';
  const { res: cb, url: cbUrl } = await follow(loc);
  assert(cb.status === 200, `callback status ${cb.status}`);
  assert(cbUrl.includes('/account'), `final url ${cbUrl}`);
  assert(jar.has('session'), 'session cookie not set');
  sessionToken = jar.get('session');
  return cbUrl;
});

// 5. Account page shows the Google profile
await step('account page shows Google profile data', async () => {
  const res = await get('/account');
  const html = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  assert(html.includes('Test Google User'), 'name missing');
  assert(html.includes('test.google@gmail.com'), 'email missing');
  assert(html.includes('Google'), 'google badge missing');
  return 'profile rendered';
});

// 6. Signed-in nav shows Account; signed-out nav shows Log in
await step('nav reflects session state', async () => {
  const signedIn = await (await get('/')).text();
  assert(/>Account</.test(signedIn), 'signed-in nav missing Account');
  const res = await post('/api/auth/logout');
  assert(res.status === 302, `logout status ${res.status}`);
  assert(!jar.has('session'), 'session cookie not cleared');
  const signedOut = await (await get('/')).text();
  assert(/>Log in</.test(signedOut), 'signed-out nav missing Log in');
  return 'logout ok, nav switched to Log in';
});

// 7. Second sign-in (existing user) -> no welcome, same session works
await step('second sign-in returns to /account without welcome', async () => {
  const start = await get('/api/auth/google/start?lang=zh');
  const loc = start.headers.get('location') ?? '';
  const { res: cb, url: cbUrl } = await follow(loc);
  assert(cb.status === 200, `callback status ${cb.status}`);
  assert(cbUrl.includes('/account') && !cbUrl.includes('welcome=1'), `final url ${cbUrl}`);
  const page = await (await get('/account')).text();
  assert(page.includes('Test Google User'), 'profile missing after 2nd login');
  return cbUrl;
});

// 8. Cancel path: Google returns error=access_denied
await step('cancel -> friendly message on /login', async () => {
  const start = await get('/api/auth/google/start?lang=zh');
  const loc = start.headers.get('location') ?? '';
  const denyUrl = new URL(loc);
  denyUrl.searchParams.set('deny', '1');
  const { url: finalUrl } = await follow(denyUrl.toString());
  assert(finalUrl.includes('error=cancelled'), `final url ${finalUrl}`);
  const page = await (await getAbs(finalUrl)).text();
  assert(/取消|You cancelled/.test(page), 'cancel message not rendered');
  return finalUrl;
});

// 9. Forged state (CSRF) is rejected
await step('forged state rejected', async () => {
  const res = await get('/api/auth/google/callback?code=x&state=forged-state-value');
  const loc = res.headers.get('location') ?? '';
  assert(loc.includes('error=invalid_state'), `location ${loc}`);
  return loc;
});

// 10. Missing code is rejected
await step('callback without code rejected', async () => {
  const start = await get('/api/auth/google/start?lang=zh');
  const loc = start.headers.get('location') ?? '';
  const state = new URL(loc).searchParams.get('state');
  const res = await get(`/api/auth/google/callback?state=${state}`);
  const loc2 = res.headers.get('location') ?? '';
  assert(loc2.includes('error=oauth_failed'), `location ${loc2}`);
  return loc2;
});

// 11. Token endpoint failure (simulated network/server failure) -> friendly error
await step('token endpoint failure -> friendly error', async () => {
  await fetch(MOCK + '/__toggle-fail', { method: 'POST' });
  try {
    const start = await get('/api/auth/google/start?lang=zh');
    const loc = start.headers.get('location') ?? '';
    const { url: finalUrl } = await follow(loc);
    assert(finalUrl.includes('error=oauth_failed'), `final url ${finalUrl}`);
    return finalUrl;
  } finally {
    await fetch(MOCK + '/__toggle-fail', { method: 'POST' });
  }
});

// 12. Unverified email is rejected (no account created)
await step('unverified email rejected', async () => {
  await fetch(MOCK + '/__set-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sub: 'google-unverified-999',
      name: 'Unverified User',
      email: 'unverified@gmail.com',
      email_verified: false,
      picture: '',
    }),
  });
  try {
    const start = await get('/api/auth/google/start?lang=zh');
    const loc = start.headers.get('location') ?? '';
    const { url: finalUrl } = await follow(loc);
    assert(finalUrl.includes('error=oauth_failed'), `final url ${finalUrl}`);
    return finalUrl;
  } finally {
    await fetch(MOCK + '/__set-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // reset to default
    });
  }
});

const passed = results.filter((r) => r.ok).length;
log(`=== SUMMARY: ${passed}/${results.length} steps passed, ${failures} failed ===`);
process.exit(failures === 0 ? 0 : 1);
