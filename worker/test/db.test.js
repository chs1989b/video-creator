import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob, listJobs, updateJob } from '../src/pipeline/db.js';

test('createJob, getJob, listJobs, updateJob round-trip through a real temp file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));

  const created = await createJob(db, {
    id: 'job-1',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
  });

  assert.equal(created.status, 'pending');
  assert.deepEqual(created.segments, []);
  assert.equal(created.resultPath, null);

  const fetched = await getJob(db, 'job-1');
  assert.equal(fetched.id, 'job-1');

  const all = await listJobs(db);
  assert.equal(all.length, 1);

  const updated = await updateJob(db, 'job-1', { status: 'downloading' });
  assert.equal(updated.status, 'downloading');

  const refetched = await getJob(db, 'job-1');
  assert.equal(refetched.status, 'downloading');

  assert.equal(await getJob(db, 'missing'), null);
});
