import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, authSecret, verifySession } from './lib/auth';
import { routeAccess } from './lib/access';

// Every page and API needs a signed-in demo user, except the login itself.
export async function middleware(request: NextRequest) {
  const access = routeAccess(request.nextUrl.pathname);
  if (access === 'public') return NextResponse.next();
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, authSecret());
  if (session) return NextResponse.next();
  if (access === 'api') return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const login = new URL('/login', request.url);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
