import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDb, updateJob } from '../src/pipeline/db.js';
import { MOCK_DEPS } from '../src/pipeline/mockGenerators.js';

async function startTestServer(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({
    dataDir,
    runJob: overrides.runJob ?? (async () => ({ resultPath: '/tmp/final.mp4' })),
    runStage: overrides.runStage ?? (async (_db, _id, _dir, stage) => ({ stage })),
    retrySegment: overrides.retrySegment ?? (async () => ({ outputPath: '/tmp/generated-0.mp4' })),
    ...(overrides.runPreview ? { runPreview: overrides.runPreview } : {}),
    ...(overrides.generator ? { generator: overrides.generator } : {}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://localhost:${port}`, dataDir };
}

async function createPreviewJob(baseUrl) {
  const form = new FormData();
  form.append('youtubeUrl', 'https://example.com/v.mp4');
  form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');
  form.append('preview', 'true');
  const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
  return { res, job: await res.json() };
}

test('POST /jobs creates a job and GET /jobs lists it', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');

    const createRes = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.youtubeUrl, 'https://youtube.com/watch?v=abc');
    assert.equal(created.status, 'idle');
    assert.equal(created.stages.generate.status, 'pending');

    const listRes = await fetch(`${baseUrl}/jobs`);
    const jobs = await listRes.json();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, created.id);
  } finally {
    server.close();
  }
});

test('POST /jobs saves the uploaded character image with its original extension', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');

    const createRes = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    const created = await createRes.json();

    // Higgsfield's CLI (and similar tools) detect media type from the file
    // extension, so a saved upload with no extension breaks generation later.
    assert.equal(created.characterImagePaths.length, 1);
    assert.match(created.characterImagePaths[0], /\.png$/);
  } finally {
    server.close();
  }
});

test('POST /jobs accepts an optional productImages file and records its path', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');
    form.append('productImages', new Blob([new Uint8Array([4, 5, 6])]), 'eyeliner.jpg');

    const createRes = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.characterImagePaths.length, 1);
    assert.equal(created.productImagePaths.length, 1);
    assert.match(created.productImagePaths[0], /\.jpg$/);
  } finally {
    server.close();
  }
});

test('POST /jobs stores a trimmed script and treats a blank one as absent', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const withScript = new FormData();
    withScript.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    withScript.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    withScript.append('script', '  Hello, this is my eyeliner.  ');
    const created = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: withScript })).json();
    assert.equal(created.script, 'Hello, this is my eyeliner.');

    const blank = new FormData();
    blank.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    blank.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    blank.append('script', '   ');
    const createdBlank = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: blank })).json();
    assert.equal(createdBlank.script, null);
  } finally {
    server.close();
  }
});

test('POST /jobs stores optional restylePrompt and editPrompt', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    form.append('restylePrompt', ' Beige shirt ');
    form.append('editPrompt', ' Warmer lighting ');
    const created = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form })).json();
    assert.equal(created.restylePrompt, 'Beige shirt');
    assert.equal(created.editPrompt, 'Warmer lighting');

    const without = new FormData();
    without.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    without.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    const createdWithout = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: without })).json();
    assert.equal(createdWithout.restylePrompt, null);
    assert.equal(createdWithout.editPrompt, null);
  } finally {
    server.close();
  }
});

test('POST /jobs without productImages records an empty productImagePaths list', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');

    const createRes = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    const created = await createRes.json();
    assert.deepEqual(created.productImagePaths, []);
  } finally {
    server.close();
  }
});

test('POST /jobs without youtubeUrl returns 400', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /jobs without a characterImages file returns 400', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /characterImages/);
  } finally {
    server.close();
  }
});

test('POST /jobs with autorun=false does not start the pipeline; /run and /stages/:stage/run start it', async () => {
  const runs = [];
  const { server, baseUrl } = await startTestServer({
    runJob: async (_db, id) => { runs.push(['job', id]); return { resultPath: null }; },
    runStage: async (_db, id, _dir, stage) => { runs.push(['stage', id, stage]); return { stage }; },
  });
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    form.append('autorun', 'false');
    const created = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form })).json();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(runs, [], 'nothing runs until asked');

    const stageRes = await fetch(`${baseUrl}/jobs/${created.id}/stages/generate/run`, { method: 'POST' });
    assert.equal(stageRes.status, 202);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(runs, [['stage', created.id, 'generate']]);

    const blocked = await fetch(`${baseUrl}/jobs/${created.id}/stages/merge/run`, { method: 'POST' });
    assert.equal(blocked.status, 409, 'merge cannot run before generate is done');

    const unknown = await fetch(`${baseUrl}/jobs/${created.id}/stages/bogus/run`, { method: 'POST' });
    assert.equal(unknown.status, 400);

    const runRes = await fetch(`${baseUrl}/jobs/${created.id}/run`, { method: 'POST' });
    assert.equal(runRes.status, 202);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(runs[1], ['job', created.id]);
  } finally {
    server.close();
  }
});

test('POST /jobs without autorun starts the whole pipeline right away', async () => {
  const runs = [];
  const { server, baseUrl } = await startTestServer({
    runJob: async (_db, id) => { runs.push(id); return { resultPath: null }; },
  });
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1])]), 'char.png');
    const created = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form })).json();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(runs, [created.id]);
  } finally {
    server.close();
  }
});

test('GET /jobs/:id returns 404 for an unknown job', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/jobs/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('POST /jobs with preview=true makes a preview job, does not autorun, and reports totals', async () => {
  let runJobCalls = 0;
  const { server, baseUrl } = await startTestServer({ runJob: async () => { runJobCalls += 1; } });
  try {
    const { res, job } = await createPreviewJob(baseUrl);
    assert.equal(res.status, 201);
    assert.equal(job.previewRequired, true);
    assert.deepEqual(job.totals, { previews: 0, credits: 0, krw: 0 });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runJobCalls, 0);

    const got = await (await fetch(`${baseUrl}/jobs/${job.id}`)).json();
    assert.deepEqual(got.totals, { previews: 0, credits: 0, krw: 0 });
  } finally {
    server.close();
  }
});

test('POST /jobs/:id/previews starts a preview with the prompt; non-preview jobs get 409', async () => {
  const calls = [];
  const { server, baseUrl } = await startTestServer({
    runPreview: async (_db, id, _dir, options) => { calls.push({ id, ...options }); },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    const form = new FormData();
    form.append('prompt', '  Keep her smile.  ');
    const res = await fetch(`${baseUrl}/jobs/${job.id}/previews`, { method: 'POST', body: form });
    assert.equal(res.status, 202);
    assert.deepEqual(calls, [{ id: job.id, prompt: 'Keep her smile.', characterImagePath: null, productImagePath: null }]);

    const plain = new FormData();
    plain.append('youtubeUrl', 'https://example.com/v.mp4');
    plain.append('characterImages', new Blob([new Uint8Array([1])]), 'c.png');
    plain.append('autorun', 'false');
    const plainJob = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: plain })).json();
    const refused = await fetch(`${baseUrl}/jobs/${plainJob.id}/previews`, { method: 'POST', body: new FormData() });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /does not use previews/);

    const missing = await fetch(`${baseUrl}/jobs/nope/previews`, { method: 'POST', body: new FormData() });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('before approval, /run and /stages/generate/run answer 409 and start nothing', async () => {
  let started = 0;
  const { server, baseUrl } = await startTestServer({
    runJob: async () => { started += 1; },
    runStage: async () => { started += 1; },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    const run = await fetch(`${baseUrl}/jobs/${job.id}/run`, { method: 'POST' });
    assert.equal(run.status, 409);
    assert.match((await run.json()).error, /approve a preview/);
    const stage = await fetch(`${baseUrl}/jobs/${job.id}/stages/generate/run`, { method: 'POST' });
    assert.equal(stage.status, 409);
    assert.equal(started, 0);
  } finally {
    server.close();
  }
});

test('verdict, unlock, attempt output and estimate routes', async () => {
  const { server, baseUrl, dataDir } = await startTestServer();
  try {
    const { job } = await createPreviewJob(baseUrl);
    const previewFile = path.join(dataDir, 'preview-1.mp4');
    await fs.writeFile(previewFile, 'fake-video');
    const db = createDb(path.join(dataDir, 'db.json'));
    await updateJob(db, job.id, {
      segments: [
        { index: 0, path: '/tmp/s0.mp4', startSeconds: 0, endSeconds: 5, status: 'pending', resultPath: null, error: null, credits: null },
        { index: 1, path: '/tmp/s1.mp4', startSeconds: 5, endSeconds: 15, status: 'pending', resultPath: null, error: null, credits: null },
      ],
      attempts: [{
        id: 'a1', n: 1, kind: 'preview', prompt: null, characterImagePath: '/tmp/c.png', productImagePath: null,
        segmentIndex: 0, status: 'done', outputPath: previewFile, estimatedCredits: 35, credits: 35,
        verdict: null, reasons: [], error: null, createdAt: '2026-09-29T00:00:00.000Z', finishedAt: '2026-09-29T00:01:00.000Z',
      }],
    });

    const video = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/output`);
    assert.equal(video.status, 200);
    assert.equal(await video.text(), 'fake-video');

    const early = await fetch(`${baseUrl}/jobs/${job.id}/previews/unlock`, { method: 'POST' });
    assert.equal(early.status, 409); // 1 of 5 used: nothing to unlock yet
    assert.match((await early.json()).error, /limit not reached/);

    const verdictRes = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }),
    });
    assert.equal(verdictRes.status, 200);
    const approved = await verdictRes.json();
    assert.equal(approved.approvedAttemptId, 'a1');
    assert.deepEqual(approved.totals, { previews: 1, credits: 35, krw: 2100 });

    const again = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }),
    });
    assert.equal(again.status, 409);

    const estimate = await (await fetch(`${baseUrl}/jobs/${job.id}/estimate`)).json();
    assert.deepEqual(estimate.items, [{ stage: 'generate', credits: 70 }]);
    assert.equal(estimate.krw, 4200);
  } finally {
    server.close();
  }
});

test('two preview requests at once start only one preview', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const { server, baseUrl } = await startTestServer({
    runPreview: async () => { calls += 1; await gate; },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    const post = () => fetch(`${baseUrl}/jobs/${job.id}/previews`, { method: 'POST', body: new FormData() });
    const [first, second] = await Promise.all([post(), post()]);
    assert.deepEqual([first.status, second.status].sort(), [202, 409]);
    assert.equal(calls, 1);

    release();
    await new Promise((r) => setTimeout(r, 20));
    const after = await post();
    assert.equal(after.status, 202); // the lock is released once the preview ends
  } finally {
    release();
    server.close();
  }
});

test('PATCH /jobs/:id adds or changes optional inputs; 404 unknown, 409 while running', async () => {
  const { server, baseUrl, dataDir } = await startTestServer();
  try {
    const { job } = await createPreviewJob(baseUrl);
    const patch = (id, body) => fetch(`${baseUrl}/jobs/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    const res = await patch(job.id, { script: 'Hi everyone.', restylePrompt: 'Beige shirt.' });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.script, 'Hi everyone.');
    assert.equal(updated.stages.voiceover.status, 'pending');
    assert.equal(updated.stages.restyle.status, 'pending');
    assert.ok(updated.totals);

    assert.equal((await patch('nope', { script: 'x' })).status, 404);

    await updateJob(createDb(path.join(dataDir, 'db.json')), job.id, { status: 'running' });
    const busy = await patch(job.id, { script: 'Changed.' });
    assert.equal(busy.status, 409);
    assert.match((await busy.json()).error, /already running/);
  } finally {
    server.close();
  }
});

test('GET /config reports the generator; mock jobs are marked and run with the mock generators', async () => {
  const seen = [];
  const { server, baseUrl } = await startTestServer({
    generator: 'mock',
    runJob: async (_db, _id, _dir, deps) => { seen.push(['run', deps]); },
    runPreview: async (_db, _id, _dir, _opts, deps) => { seen.push(['preview', deps]); },
  });
  try {
    assert.deepEqual(await (await fetch(`${baseUrl}/config`)).json(), { generator: 'mock' });
    const { job } = await createPreviewJob(baseUrl);
    assert.equal(job.mock, true);

    assert.equal((await fetch(`${baseUrl}/jobs/${job.id}/previews`, { method: 'POST', body: new FormData() })).status, 202);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen[0][0], 'preview');
    assert.equal(seen[0][1].generateFromSegment, MOCK_DEPS.generateFromSegment);
    assert.equal(seen[0][1].editVideo, MOCK_DEPS.editVideo);
    assert.equal(seen[0][1].synthesizeSpeech, MOCK_DEPS.synthesizeSpeech);
  } finally {
    server.close();
  }

  const real = await startTestServer();
  try {
    assert.deepEqual(await (await fetch(`${real.baseUrl}/config`)).json(), { generator: 'higgsfield' });
  } finally {
    real.server.close();
  }
});

test('a job never runs under the other generator (no fake segments in a paid job, no credits on a test job)', async () => {
  let started = 0;
  const { server, baseUrl, dataDir } = await startTestServer({
    runJob: async () => { started += 1; },
    runStage: async () => { started += 1; },
    runPreview: async () => { started += 1; },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    assert.equal(job.mock, false);
    await updateJob(createDb(path.join(dataDir, 'db.json')), job.id, { mock: true, approvedAttemptId: 'a1' });

    for (const [method, route] of [['POST', 'previews'], ['POST', 'run'], ['POST', 'stages/merge/run'], ['POST', 'segments/0/retry']]) {
      const res = await fetch(`${baseUrl}/jobs/${job.id}/${route}`, { method, body: route === 'previews' ? new FormData() : undefined });
      assert.equal(res.status, 409, route);
      assert.match((await res.json()).error, /test \(mock\) job/, route);
    }
    assert.equal(started, 0);
  } finally {
    server.close();
  }
});

async function createOwnedJob(baseUrl, owner) {
  const form = new FormData();
  form.append('youtubeUrl', 'https://example.com/v.mp4');
  form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');
  form.append('preview', 'true');
  const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form, headers: owner ? { 'x-owner-id': owner } : {} });
  return res.json();
}

test('jobs carry the x-owner-id they were created with, and GET /jobs shows only that owner\'s jobs', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const mine = await createOwnedJob(baseUrl, 'chris');
    const theirs = await createOwnedJob(baseUrl, 'juwon');
    await createOwnedJob(baseUrl, null);
    assert.equal(mine.ownerId, 'chris');

    const listed = await (await fetch(`${baseUrl}/jobs`, { headers: { 'x-owner-id': 'chris' } })).json();
    assert.deepEqual(listed.map((j) => j.id), [mine.id]);
    // Without the header (direct local calls, old clients) every job is listed, as before.
    assert.equal((await (await fetch(`${baseUrl}/jobs`)).json()).length, 3);
    assert.equal(theirs.ownerId, 'juwon');
  } finally {
    server.close();
  }
});

test('another owner\'s job answers 404 on every job route', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const theirs = await createOwnedJob(baseUrl, 'juwon');
    const as = { headers: { 'x-owner-id': 'chris' } };
    const routes = [
      ['GET', `/jobs/${theirs.id}`],
      ['PATCH', `/jobs/${theirs.id}`],
      ['POST', `/jobs/${theirs.id}/run`],
      ['POST', `/jobs/${theirs.id}/stages/merge/run`],
      ['POST', `/jobs/${theirs.id}/previews`],
      ['POST', `/jobs/${theirs.id}/previews/unlock`],
      ['POST', `/jobs/${theirs.id}/attempts/a1/verdict`],
      ['GET', `/jobs/${theirs.id}/attempts/a1/output`],
      ['GET', `/jobs/${theirs.id}/estimate`],
      ['POST', `/jobs/${theirs.id}/segments/0/retry`],
      ['GET', `/jobs/${theirs.id}/result`],
      ['GET', `/jobs/${theirs.id}/stages/merge/output`],
    ];
    for (const [method, route] of routes) {
      const res = await fetch(`${baseUrl}${route}`, { method, ...as });
      assert.equal(res.status, 404, `${method} ${route}`);
    }
    // The owner still reaches it.
    assert.equal((await fetch(`${baseUrl}/jobs/${theirs.id}`, { headers: { 'x-owner-id': 'juwon' } })).status, 200);
  } finally {
    server.close();
  }
});

function sourceForm({ url, video } = {}) {
  const form = new FormData();
  if (url) form.append('youtubeUrl', url);
  if (video) form.append('sourceVideo', new Blob([new Uint8Array([0, 0, 0, 24])]), video);
  form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');
  form.append('preview', 'true');
  return form;
}

test('POST /jobs accepts an uploaded source video instead of a URL', async () => {
  const { server, baseUrl, dataDir } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: sourceForm({ video: 'My Review.MOV' }) });
    assert.equal(res.status, 201);
    const job = await res.json();
    assert.equal(job.youtubeUrl, null);
    assert.equal(job.sourceVideoName, 'My Review.MOV');
    assert.ok(job.sourceVideoPath.startsWith(path.join(dataDir, 'uploads')));
    assert.ok(job.sourceVideoPath.toLowerCase().endsWith('.mov'));
    await fs.access(job.sourceVideoPath);
  } finally {
    server.close();
  }
});

test('POST /jobs needs exactly one source: a URL or a video file of an allowed type', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const cases = [
      [{}, /원본 영상/],
      [{ url: 'https://e.com/v.mp4', video: 'v.mp4' }, /하나만/],
      [{ video: 'notes.txt' }, /mp4/],
    ];
    for (const [input, message] of cases) {
      const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: sourceForm(input) });
      assert.equal(res.status, 400, JSON.stringify(input));
      assert.match((await res.json()).error, message);
    }
  } finally {
    server.close();
  }
});

test('POST /jobs keeps a Korean source file name readable', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const job = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: sourceForm({ video: '내 리뷰 영상.mp4' }) })).json();
    assert.equal(job.sourceVideoName, '내 리뷰 영상.mp4');
  } finally {
    server.close();
  }
});
