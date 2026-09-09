// Unsubscribe links must keep working years after the email was sent, so the
// token carries no expiry: it is only a proof that this address was issued a
// link by us, not a session.
const ENCODER = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmac(email: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(email.trim().toLowerCase())
  );
  return new Uint8Array(signature);
}

export async function signMailToken(email: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(email, secret));
}

export async function verifyMailToken(
  email: string,
  token: string,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const expected = await signMailToken(email, secret);
  if (expected.length !== token.length) return false;
  // Constant time: a length-independent early return would leak the prefix.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
