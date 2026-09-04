export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 30
): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is required');
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${expiry}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<string | null> {
  if (!secret) throw new Error('SESSION_SECRET is required');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiryStr, sigB64] = parts;
  const expiry = Number(expiryStr);
  if (!userId || !Number.isFinite(expiry)) return null;
  if (Math.floor(Date.now() / 1000) > expiry) return null;

  const payload = `${userId}.${expiryStr}`;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(sigB64) as BufferSource, new TextEncoder().encode(payload));
  return valid ? userId : null;
}

// ---- Signed JSON cookies -------------------------------------------------
// Generic HMAC-signed `<base64url(json)>.<base64url(sig)>` tokens, shared by
// the pending-draw and last-reading cookies.

export async function signJsonToken(payload: unknown, secret: string): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is required');
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Verify the signature and return the decoded payload, or null. */
export async function readJsonToken(
  token: string | undefined | null,
  secret: string
): Promise<unknown | null> {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sigB64] = parts;

  const key = await hmacKey(secret);
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64) as BufferSource,
      new TextEncoder().encode(encoded)
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}
