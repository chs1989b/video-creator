import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_MS, authSecret, signSession } from '@/lib/auth';
import { authenticate } from '@/lib/users';
import { loadUsers } from '@/lib/userStore';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const users = await loadUsers();
  if (users.length === 0) {
    return NextResponse.json(
      { error: '데모 계정이 없습니다. web 폴더에서 node scripts/add-user.mjs 로 계정을 만드세요.' },
      { status: 503 },
    );
  }
  const user = await authenticate(users, username, password);
  if (!user) return NextResponse.json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' }, { status: 401 });

  const token = await signSession({ sub: user.username, name: user.name, exp: Date.now() + SESSION_TTL_MS }, authSecret());
  const res = NextResponse.json({ username: user.username, name: user.name });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
