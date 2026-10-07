import type { RefineInput, RefineResult } from './promptBuilder';

// Browser side of "다듬기": calls the web app's own API route, not the worker.

export async function requestRefine(
  input: RefineInput,
  { fetchFn = fetch }: { fetchFn?: typeof fetch } = {},
): Promise<RefineResult> {
  let res: Response;
  try {
    res = await fetchFn('/api/prompt/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('웹 서버에 연결할 수 없습니다.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `프롬프트 다듬기 실패 (status ${res.status})`);
  return body as RefineResult;
}
