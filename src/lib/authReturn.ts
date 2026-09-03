/** Only allow local content pages as post-authentication destinations. */
export function safeAuthReturn(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020]/.test(decoded) || decoded.startsWith('//')) return fallback;
    const url = new URL(value, 'https://local.invalid');
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://local.invalid' || /^\/(?:login|signup|api)(?:\/|$)/.test(path)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
