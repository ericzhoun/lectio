// Dev-only mock Google Identity Provider for E2E verification.
//   GET  /auth      -> redirects to the app's callback with ?code=...&state=...
//   POST /token     -> returns a fake access token (500 when fail-mode is on)
//   GET  /userinfo  -> returns the configured test profile (500 when fail-mode is on)
//   POST /__toggle-fail  -> switch token/userinfo endpoints to 500 (failure-path testing)
//   POST /__set-user     -> replace the test profile (body: JSON; {} resets to default)
// Every response uses Connection: close to keep the local harness deterministic.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 9000);
let failMode = false;
let currentUser = null;

const defaultUser = {
  sub: 'google-1111111111111111',
  name: 'Test Google User',
  email: 'test.google@gmail.com',
  email_verified: true,
  picture: '',
};

function user() {
  if (currentUser) return { ...defaultUser, ...currentUser };
  if (process.env.MOCK_GOOGLE_USER) {
    try {
      return { ...defaultUser, ...JSON.parse(process.env.MOCK_GOOGLE_USER) };
    } catch {
      /* fall through to default */
    }
  }
  return defaultUser;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Connection': 'close', ...headers });
  res.end(body);
}

function redirect(res, location) {
  send(res, 302, undefined, { Location: location });
}

let codeCounter = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  console.log(`[mock-google] ${req.method} ${url.pathname}${url.search}`);

  const readBody = () =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => resolve(body));
      req.on('error', () => resolve(body));
    });

  (async () => {
    try {
      if (req.method === 'POST' && url.pathname === '/__toggle-fail') {
        failMode = !failMode;
        send(res, 200, JSON.stringify({ failMode }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/__set-user') {
        const body = await readBody();
        currentUser = JSON.parse(body || '{}');
        send(res, 200, JSON.stringify({ user: user() }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth') {
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const state = url.searchParams.get('state') ?? '';
        const deny = url.searchParams.get('deny') === '1';
        const target = new URL(redirectUri);
        if (deny) {
          target.searchParams.set('error', 'access_denied');
          target.searchParams.set('state', state);
        } else {
          codeCounter += 1;
          target.searchParams.set('code', `mock-code-${codeCounter}`);
          target.searchParams.set('state', state);
        }
        redirect(res, target.toString());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const body = await readBody();
        if (failMode) {
          send(res, 500, JSON.stringify({ error: 'server_error' }), { 'Content-Type': 'application/json' });
          return;
        }
        const form = new URLSearchParams(body);
        const ok =
          form.get('grant_type') === 'authorization_code' &&
          (form.get('code') ?? '').startsWith('mock-code') &&
          form.get('client_id') === 'mock-client-id' &&
          form.get('client_secret') === 'mock-client-secret';
        if (!ok) {
          send(res, 400, JSON.stringify({ error: 'invalid_grant' }), { 'Content-Type': 'application/json' });
          return;
        }
        send(res, 200, JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 3600, id_token: 'mock-id-token' }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/userinfo') {
        if (failMode) {
          send(res, 500, JSON.stringify({ error: 'server_error' }), { 'Content-Type': 'application/json' });
          return;
        }
        const auth = req.headers.authorization ?? '';
        if (auth !== 'Bearer mock-access-token') {
          send(res, 401, JSON.stringify({ error: 'invalid_token' }), { 'Content-Type': 'application/json' });
          return;
        }
        send(res, 200, JSON.stringify(user()), { 'Content-Type': 'application/json' });
        return;
      }

      send(res, 404, 'not found');
    } catch (err) {
      console.error('[mock-google] handler error:', err);
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: 'mock_internal' }), { 'Content-Type': 'application/json' });
      }
    }
  })();
});

server.on('error', (err) => {
  console.error('[mock-google] server error:', err);
});

server.listen(PORT, () => {
  console.log(`[mock-google] listening on http://localhost:${PORT}`);
  console.log(`[mock-google] test profile: ${JSON.stringify(user())}`);
});
