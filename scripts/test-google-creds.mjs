// Probe real Google OAuth with credentials from .env (values never printed)
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

const clientId = env.GOOGLE_CLIENT_ID;
const clientSecret = env.GOOGLE_CLIENT_SECRET;
const redirectUri = env.GOOGLE_REDIRECT_URI;
const authUrl = `${env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth'}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('openid email profile')}&state=probe-state-1234567890ab`;

// --- Test 1: authorization endpoint renders a consent page? ---
console.log('=== Test 1: GET authorization URL ===');
const authRes = await fetch(authUrl, { redirect: 'manual' });
const authBody = await authRes.text();
console.log('HTTP', authRes.status, '| final URL:', authRes.url ? '(followed)' : '(not followed)');
const errMatch = authBody.match(/(redirect_uri_mismatch|invalid_client|Error 40[0-9]:\s*[a-z_ ]+|access_denied)/i);
console.log('error markers:', errMatch ? errMatch[1] : 'none found');
console.log(
  'verdict:',
  errMatch
    ? 'Google returned an ERROR page — see marker above'
    : authRes.status === 200 && /sign in|google|accounts/i.test(authBody)
      ? 'consent/sign-in page rendered — client_id + redirect_uri are ACCEPTED'
      : `status ${authRes.status}, body ${authBody.length} bytes — inspect manually`
);

// --- Test 2: token endpoint with a fake code ---
console.log('\n=== Test 2: POST token endpoint with fake code ===');
const tokenRes = await fetch(env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code: 'probe-invalid-code-000',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }),
});
const tokenBody = await tokenRes.json().catch(() => ({}));
console.log('HTTP', tokenRes.status, '| error:', tokenBody.error ?? '(none)');
console.log(
  'verdict:',
  tokenBody.error === 'invalid_grant'
    ? 'credentials VALID (client auth passed; only the code was fake) — Google login will work'
    : tokenBody.error === 'redirect_uri_mismatch'
      ? 'redirect_uri NOT registered in Google Console — add it to the OAuth client'
      : tokenBody.error === 'invalid_client'
        ? 'client_id/secret REJECTED — check the values in .env'
        : `unexpected: ${JSON.stringify(tokenBody).slice(0, 200)}`
);
