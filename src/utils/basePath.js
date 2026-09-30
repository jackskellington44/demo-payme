// Vite base (e.g. '/demo-payme/' on GitHub Pages, '/' locally).
export const BASE_PATH = import.meta.env.BASE_URL || '/';

// '/login' -> '/demo-payme/login'
export function appPath(path = '/') {
  const cleaned = String(path || '/').replace(/^\/+/, '');
  return `${BASE_PATH}${cleaned}`;
}

// '/demo-payme/login' -> '/login'
export function stripBasePath(pathname = '/') {
  const raw = String(pathname || '/');
  const baseNoSlash = BASE_PATH.replace(/\/+$/, '');
  if (baseNoSlash && (raw === baseNoSlash || raw.startsWith(`${baseNoSlash}/`))) {
    return raw.slice(baseNoSlash.length) || '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}
