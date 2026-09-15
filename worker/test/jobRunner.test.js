import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob } from '../src/pipeline/db.js';
import { runJob, retrySegment } from '../src/pipeline/jobRunner.js';

async function setup() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobrunner-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-1',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
  });
  return { db, tmpDir };
}

test('runJob walks the full pipeline and marks the job done', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
      { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 10, endSeconds: 15 },
    ],
    generateFromSegment: async (segmentPath, _chars, outputPath) => ({ outputPath }),
    mergeSegments: async (_paths, outputPath) => ({ outputPath }),
  };

  const result = await runJob(db, 'job-1', tmpDir, deps);

  assert.equal(result.resultPath, path.join(tmpDir, 'final.mp4'));

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.resultPath, path.join(tmpDir, 'final.mp4'));
  assert.equal(job.segments.length, 2);
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[1].status, 'done');
});

test('runJob marks the failing segment and the job itself as failed, and stops before merging', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
    ],
    generateFromSegment: async () => {
      throw new Error('higgsfield call failed');
    },
    mergeSegments: async () => {
      throw new Error('should not be called');
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /higgsfield call failed/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'failed');
  assert.equal(job.segments[0].error, 'higgsfield call failed');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'higgsfield call failed');
});

test('runJob marks the job as failed (with no segments recorded) when the download step itself fails', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => {
      throw new Error('video unavailable');
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /video unavailable/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'video unavailable');
  assert.deepEqual(job.segments, []);
});

test('retrySegment re-runs a single segment and updates only that segment', async () => {
  const { db, tmpDir } = await setup();

  const failingDeps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
    ],
    generateFromSegment: async () => {
      throw new Error('boom');
    },
    mergeSegments: async () => ({ outputPath: path.join(tmpDir, 'final.mp4') }),
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, failingDeps));

  const failedJob = await getJob(db, 'job-1');
  assert.equal(failedJob.segments[0].status, 'failed');
  assert.equal(failedJob.segments[0].error, 'boom');

  const retryResult = await retrySegment(db, 'job-1', 0, tmpDir, {
    generateFromSegment: async (_segmentPath, _chars, outputPath) => ({ outputPath }),
  });

  assert.equal(retryResult.outputPath, path.join(tmpDir, 'generated-0.mp4'));

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[0].resultPath, path.join(tmpDir, 'generated-0.mp4'));
  assert.equal(job.segments[0].error, null, 'stale error from the earlier failure must be cleared on a successful retry');
});
