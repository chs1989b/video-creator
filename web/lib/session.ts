import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, authSecret, verifySession, type Session } from './auth';

/** The signed-in user of a route-handler request (the middleware already let it in). */
export async function currentSession(request: NextRequest): Promise<Session | null> {
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value, authSecret());
}
