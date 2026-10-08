import { NextResponse, type NextRequest } from 'next/server';
import { currentSession } from '@/lib/session';
import { forwardRequestHeaders, forwardResponseHeaders, workerTarget } from '@/lib/workerProxy';

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:4000';

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, { params }: Context) {
  const session = await currentSession(request);
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const target = workerTarget(WORKER_URL, (await params).path, request.nextUrl.search);
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: forwardRequestHeaders(request.headers, session.sub),
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body; // streamed: uploads go through without buffering
    init.duplex = 'half';
  }
  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    return NextResponse.json({ error: '워커 서버에 연결할 수 없습니다. worker가 실행 중인지 확인해주세요.' }, { status: 502 });
  }
  return new Response(res.body, { status: res.status, headers: forwardResponseHeaders(res.headers) });
}

export { forward as GET, forward as POST, forward as PATCH };
