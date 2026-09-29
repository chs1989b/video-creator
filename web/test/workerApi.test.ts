import { test, expect } from 'vitest';
import { createJob, getJob, runJob, runStage, resultUrl, stageOutputUrl } from '../lib/workerApi';

function fakeFile(name: string): File {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

function recordingFetch(status = 201, body: unknown = { id: 'job-1', status: 'idle' }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

test('createJob posts youtubeUrl and characterImages as multipart form data', async () => {
  const { calls, fetchFn } = recordingFetch();

  const job = await createJob(
    { youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png') },
    { baseUrl: 'http://localhost:4000', fetchFn },
  );

  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe('http://localhost:4000/jobs');
  expect(calls[0].init.method).toBe('POST');
  const body = calls[0].init.body as FormData;
  expect(body.get('youtubeUrl')).toBe('https://youtube.com/watch?v=abc');
  expect((body.get('characterImages') as File).name).toBe('char.png');
  expect(body.get('productImages')).toBeNull();
  expect(body.get('script')).toBeNull();
  expect(body.get('autorun')).toBeNull();
  expect(job.id).toBe('job-1');
});

test('createJob appends product image, prompts, and script only when given', async () => {
  const { calls, fetchFn } = recordingFetch();

  await createJob(
    {
      youtubeUrl: 'https://youtube.com/watch?v=abc',
      characterImage: fakeFile('char.png'),
      productImage: fakeFile('eyeliner.jpg'),
      script: '  Meet my eyeliner.  ',
      restylePrompt: ' Beige shirt ',
      editPrompt: ' Warmer light ',
    },
    { fetchFn },
  );

  const body = calls[0].init.body as FormData;
  expect((body.get('productImages') as File).name).toBe('eyeliner.jpg');
  expect(body.get('script')).toBe('Meet my eyeliner.');
  expect(body.get('restylePrompt')).toBe('Beige shirt');
  expect(body.get('editPrompt')).toBe('Warmer light');
});

test('createJob omits a blank script and sends autorun=false for step-by-step runs', async () => {
  const { calls, fetchFn } = recordingFetch();

  await createJob(
    { youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png'), script: '   ', autorun: false },
    { fetchFn },
  );

  const body = calls[0].init.body as FormData;
  expect(body.get('script')).toBeNull();
  expect(body.get('autorun')).toBe('false');
});

test('createJob throws the server error message on a non-ok response', async () => {
  const { fetchFn } = recordingFetch(400, { error: 'youtubeUrl is required' });
  await expect(
    createJob({ youtubeUrl: '', characterImage: fakeFile('char.png') }, { fetchFn }),
  ).rejects.toThrow(/youtubeUrl is required/);
});

test('getJob fetches the job by id and returns it', async () => {
  const { calls, fetchFn } = recordingFetch(200, { id: 'job-1', status: 'done' });
  const job = await getJob('job-1', { baseUrl: 'http://localhost:4000', fetchFn });
  expect(calls[0].url).toBe('http://localhost:4000/jobs/job-1');
  expect(job.status).toBe('done');
});

test('getJob throws on a non-ok response', async () => {
  const { fetchFn } = recordingFetch(404, {});
  await expect(getJob('missing', { fetchFn })).rejects.toThrow(/404/);
});

test('runJob and runStage post to the resume and single-stage endpoints', async () => {
  const { calls, fetchFn } = recordingFetch(202, { ok: true });

  await runJob('job-1', { baseUrl: 'http://localhost:4000', fetchFn });
  await runStage('job-1', 'restyle', { baseUrl: 'http://localhost:4000', fetchFn });

  expect(calls.map((c) => [c.url, c.init.method])).toEqual([
    ['http://localhost:4000/jobs/job-1/run', 'POST'],
    ['http://localhost:4000/jobs/job-1/stages/restyle/run', 'POST'],
  ]);
});

test('runStage surfaces the server message when the stage cannot run yet', async () => {
  const { fetchFn } = recordingFetch(409, { error: 'stage merge needs the earlier stages to finish first' });
  await expect(runStage('job-1', 'merge', { fetchFn })).rejects.toThrow(/earlier stages/);
});

test('connection failures produce a friendly message for every call', async () => {
  const fetchFn = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  await expect(
    createJob({ youtubeUrl: 'https://youtube.com/watch?v=abc', characterImage: fakeFile('char.png') }, { fetchFn }),
  ).rejects.toThrow(/워커 서버에 연결할 수 없습니다/);
  await expect(getJob('job-1', { fetchFn })).rejects.toThrow(/워커 서버에 연결할 수 없습니다/);
  await expect(runJob('job-1', { fetchFn })).rejects.toThrow(/워커 서버에 연결할 수 없습니다/);
});

test('resultUrl and stageOutputUrl build worker URLs', () => {
  expect(resultUrl('job-1', { baseUrl: 'http://localhost:4000' })).toBe('http://localhost:4000/jobs/job-1/result');
  expect(stageOutputUrl('job-1', 'merge', { baseUrl: 'http://localhost:4000' })).toBe(
    'http://localhost:4000/jobs/job-1/stages/merge/output',
  );
});
