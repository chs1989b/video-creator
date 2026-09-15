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

  const job = await createJob('https://youtube.com/watch?v=abc', fakeFile('char.png'), {
    baseUrl: 'http://localhost:4000',
    fetchFn: fakeFetch as typeof fetch,
  });

  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe('http://localhost:4000/jobs');
  expect(calls[0].init.method).toBe('POST');
  const body = calls[0].init.body as FormData;
  expect(body.get('youtubeUrl')).toBe('https://youtube.com/watch?v=abc');
  expect((body.get('characterImages') as File).name).toBe('char.png');
  expect(job.id).toBe('job-1');
});

test('createJob throws the server error message on a non-ok response', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ error: 'youtubeUrl is required' }), { status: 400 });

  await expect(
    createJob('', fakeFile('char.png'), { fetchFn: fakeFetch as typeof fetch }),
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

test('resultUrl builds the download URL for a job', () => {
  expect(resultUrl('job-1', { baseUrl: 'http://localhost:4000' })).toBe(
    'http://localhost:4000/jobs/job-1/result',
  );
});
