import { describe, expect, it } from 'vitest';
import { requestRefine } from '../lib/promptApi';

describe('requestRefine', () => {
  it('posts the request to the web API and returns the suggestion', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ prompt: 'P', explanation_ko: 'E', changed: [], kept: [], source: 'template' }));
    }) as typeof fetch;

    const result = await requestRefine({ stage: 'edit', request: '따뜻하게' }, { fetchFn });

    expect(calls[0].url).toBe('/api/prompt/refine');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ stage: 'edit', request: '따뜻하게' });
    expect(result.prompt).toBe('P');
  });

  it('throws the server message on a bad request', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: '다듬을 내용을 입력해 주세요.' }), { status: 400 })) as typeof fetch;
    await expect(requestRefine({ stage: 'edit', request: '' }, { fetchFn })).rejects.toThrow('다듬을 내용을 입력해 주세요.');
  });
});
