import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

async function startTestServer(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({
    dataDir,
    runJob: overrides.runJob ?? (async () => ({ resultPath: '/tmp/final.mp4' })),
    retrySegment: overrides.retrySegment ?? (async () => ({ outputPath: '/tmp/generated-0.mp4' })),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://localhost:${port}` };
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
    assert.equal(created.status, 'pending');

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

test('GET /jobs/:id returns 404 for an unknown job', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/jobs/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
