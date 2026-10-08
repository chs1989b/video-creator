import { expect, it } from 'vitest';
import { routeAccess } from '../lib/access';

it('only the login page and login/logout APIs are open without a session', () => {
  expect(routeAccess('/login')).toBe('public');
  expect(routeAccess('/api/auth/login')).toBe('public');
  expect(routeAccess('/api/auth/logout')).toBe('public');
  expect(routeAccess('/api/auth/me')).toBe('api');
  expect(routeAccess('/api/worker/jobs')).toBe('api');
  expect(routeAccess('/api/prompt/refine')).toBe('api');
  expect(routeAccess('/')).toBe('page');
  expect(routeAccess('/login/extra')).toBe('page');
});
