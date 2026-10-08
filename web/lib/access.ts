// Which requests the middleware lets through without a session.
export type Access = 'public' | 'api' | 'page';

const PUBLIC = new Set(['/login', '/api/auth/login', '/api/auth/logout']);

export function routeAccess(pathname: string): Access {
  if (PUBLIC.has(pathname)) return 'public';
  return pathname.startsWith('/api/') ? 'api' : 'page';
}
