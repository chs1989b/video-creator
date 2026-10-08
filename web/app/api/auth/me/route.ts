import { NextResponse, type NextRequest } from 'next/server';
import { currentSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  return NextResponse.json({ username: session.sub, name: session.name });
}
