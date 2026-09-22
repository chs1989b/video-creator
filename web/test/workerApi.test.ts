import { test, expect } from 'vitest';
import { createJob, getJob, resultUrl } from '../lib/workerApi';

function fakeFile(name: string): File {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

test('createJob posts youtubeUrl and characterImages as multipart form data', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ id: 'job-1', status: 'pending', segments: [], resultPath: null }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const job = await createJob(
    { youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png') },
    { baseUrl: 'http://localhost:4000', fetchFn: fakeFetch as typeof fetch },
  );

  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe('http://localhost:4000/jobs');
  expect(calls[0].init.method).toBe('POST');
  const body = calls[0].init.body as FormData;
  expect(body.get('youtubeUrl')).toBe('https://youtube.com/watch?v=abc');
  expect((body.get('characterImages') as File).name).toBe('char.png');
  expect(body.get('productImages')).toBeNull();
  expect(body.get('script')).toBeNull();
  expect(job.id).toBe('job-1');
});

test('createJob appends productImages and script only when given', async () => {
  const calls: Array<{ init: RequestInit }> = [];
  const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(JSON.stringify({ id: 'job-2', status: 'pending' }), { status: 201 });
  };

  await createJob(
    {
      youtubeUrl: 'https://youtube.com/watch?v=abc',
      characterImage: fakeFile('char.png'),
      productImage: fakeFile('eyeliner.jpg'),
      script: '  Meet my eyeliner.  ',
      editPrompt: ' Warmer light ',
    },
    { fetchFn: fakeFetch as typeof fetch },
  );

  const body = calls[0].init.body as FormData;
  expect((body.get('productImages') as File).name).toBe('eyeliner.jpg');
  expect(body.get('script')).toBe('Meet my eyeliner.');
  expect(body.get('editPrompt')).toBe('Warmer light');
});

test('createJob omits a blank script', async () => {
  const calls: Array<{ init: RequestInit }> = [];
  const fakeFetch = async (_url: string | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(JSON.stringify({ id: 'job-3', status: 'pending' }), { status: 201 });
  };

  await createJob(
    { youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png'), script: '   ' },
    { fetchFn: fakeFetch as typeof fetch },
  );

  expect((calls[0].init.body as FormData).get('script')).toBeNull();
});

test('createJob throws the server error message on a non-ok response', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ error: 'youtubeUrl is required' }), { status: 400 });

  await expect(
    createJob({ youtubeUrl: '', characterImage: fakeFile('char.png') }, { fetchFn: fakeFetch as typeof fetch }),
  ).rejects.toThrow(/youtubeUrl is required/);
});

test('getJob fetches the job by id and returns it', async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'job-1', status: 'done' }), { status: 200 });
  };

  const job = await getJob('job-1', { baseUrl: 'http://localhost:4000', fetchFn: fakeFetch as typeof fetch });

  expect(calls[0]).toBe('http://localhost:4000/jobs/job-1');
  expect(job.status).toBe('done');
});

test('getJob throws on a non-ok response', async () => {
  const fakeFetch = async () => new Response('not found', { status: 404 });

  await expect(getJob('missing', { fetchFn: fakeFetch as typeof fetch })).rejects.toThrow(/404/);
});

test('createJob throws a friendly connection error when fetchFn itself fails', async () => {
  const fakeFetch = async () => {
    throw new Error('network down');
  };

  await expect(
    createJob(
      { youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png') },
      { fetchFn: fakeFetch as unknown as typeof fetch },
    ),
  ).rejects.toThrow(/워커 서버에 연결할 수 없습니다/);
});

test('getJob throws a friendly connection error when fetchFn itself fails', async () => {
  const fakeFetch = async () => {
    throw new Error('network down');
  };

  await expect(
    getJob('job-1', { fetchFn: fakeFetch as unknown as typeof fetch }),
  ).rejects.toThrow(/워커 서버에 연결할 수 없습니다/);
});

test('resultUrl builds the download URL for a job', () => {
  expect(resultUrl('job-1', { baseUrl: 'http://localhost:4000' })).toBe(
    'http://localhost:4000/jobs/job-1/result',
  );
});
