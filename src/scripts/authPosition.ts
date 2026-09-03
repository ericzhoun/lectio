// Keep position across full-page sign-in redirects, including Google OAuth.
const key = 'inspire-auth-position';
const currentPath = () => location.pathname + location.search + location.hash;
function rememberPosition() {
  if (['/login', '/signup'].includes(location.pathname)) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ path: currentPath(), x: scrollX, y: scrollY, at: Date.now() }));
  } catch { /* Sign-in still works when browser storage is disabled. */ }
}
document.addEventListener('submit', (event) => {
  if ((event.target as HTMLFormElement).matches('[data-login-form]')) rememberPosition();
}, true);
document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (link && ['/api/auth/google/start', '/signup'].includes(new URL(link.href).pathname)) rememberPosition();
}, true);
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (saved && saved.path === currentPath()) {
    sessionStorage.removeItem(key);
    if (Date.now() - saved.at < 30 * 60 * 1000) {
      const restore = () => requestAnimationFrame(() => scrollTo(saved.x, saved.y));
      if (document.readyState === 'complete') restore();
      else window.addEventListener('load', restore, { once: true });
    }
  }
} catch { /* Ignore missing or stale position data. */ }
