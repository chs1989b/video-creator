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

test('runJob narrates the merged video when the job has a script and returns the voiced file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobrunner-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-voiced',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
    script: 'Hi everyone, meet my favorite eyeliner.',
  });

  const ttsCalls = [];
  const muxCalls = [];
  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [{ index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 }],
    generateFromSegment: async (_segmentPath, _chars, outputPath) => ({ outputPath }),
    mergeSegments: async (_paths, outputPath) => ({ outputPath }),
    synthesizeSpeech: async (script, outputPath) => {
      ttsCalls.push({ script, outputPath });
      return { outputPath };
    },
    muxVoiceover: async (videoPath, audioPath, outputPath) => {
      muxCalls.push({ videoPath, audioPath, outputPath });
      return { outputPath };
    },
  };

  const result = await runJob(db, 'job-voiced', tmpDir, deps);

  assert.deepEqual(ttsCalls, [
    { script: 'Hi everyone, meet my favorite eyeliner.', outputPath: path.join(tmpDir, 'voiceover.mp3') },
  ]);
  assert.deepEqual(muxCalls, [
    {
      videoPath: path.join(tmpDir, 'final.mp4'),
      audioPath: path.join(tmpDir, 'voiceover.mp3'),
      outputPath: path.join(tmpDir, 'final-voiced.mp4'),
    },
  ]);
  assert.equal(result.resultPath, path.join(tmpDir, 'final-voiced.mp4'));
  const job = await getJob(db, 'job-voiced');
  assert.equal(job.status, 'done');
  assert.equal(job.resultPath, path.join(tmpDir, 'final-voiced.mp4'));
});

test('runJob skips the voice-over stage entirely when the job has no script', async () => {
  const { db, tmpDir } = await setup();
  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [{ index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 }],
    generateFromSegment: async (_segmentPath, _chars, outputPath) => ({ outputPath }),
    mergeSegments: async (_paths, outputPath) => ({ outputPath }),
    synthesizeSpeech: async () => {
      throw new Error('should not be called');
    },
    muxVoiceover: async () => {
      throw new Error('should not be called');
    },
  };

  const result = await runJob(db, 'job-1', tmpDir, deps);
  assert.equal(result.resultPath, path.join(tmpDir, 'final.mp4'));
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

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /1 segment\(s\) failed to generate/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'failed');
  assert.equal(job.segments[0].error, 'higgsfield call failed');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, '1 segment(s) failed to generate');
});

test('runJob attempts every remaining segment after one fails, then fails the job without merging', async () => {
  const { db, tmpDir } = await setup();
  const attempted = [];

  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
      { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 10, endSeconds: 20 },
      { index: 2, path: '/tmp/segment-002.mp4', startSeconds: 20, endSeconds: 30 },
    ],
    generateFromSegment: async (segmentPath, _chars, outputPath) => {
      attempted.push(segmentPath);
      if (segmentPath === '/tmp/segment-001.mp4') {
        throw new Error('middle segment boom');
      }
      return { outputPath };
    },
    mergeSegments: async () => {
      throw new Error('should not be called');
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /1 segment\(s\) failed to generate/);

  assert.deepEqual(attempted, [
    '/tmp/segment-000.mp4',
    '/tmp/segment-001.mp4',
    '/tmp/segment-002.mp4',
  ]);

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[1].status, 'failed');
  assert.equal(job.segments[1].error, 'middle segment boom');
  assert.equal(job.segments[2].status, 'done');
  assert.equal(job.status, 'failed');
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
    mergeSegments: async (_paths, outputPath) => ({ outputPath }),
  });

  assert.equal(retryResult.outputPath, path.join(tmpDir, 'generated-0.mp4'));

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[0].resultPath, path.join(tmpDir, 'generated-0.mp4'));
  assert.equal(job.segments[0].error, null, 'stale error from the earlier failure must be cleared on a successful retry');
});

test('retrySegment auto-merges once the retry clears the last failed segment, reaching a done job with resultPath', async () => {
  const { db, tmpDir } = await setup();

  const initialDeps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
      { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 10, endSeconds: 20 },
      { index: 2, path: '/tmp/segment-002.mp4', startSeconds: 20, endSeconds: 30 },
    ],
    generateFromSegment: async (segmentPath, _chars, outputPath) => {
      if (segmentPath === '/tmp/segment-001.mp4') {
        throw new Error('middle segment boom');
      }
      return { outputPath };
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, initialDeps));

  const partialJob = await getJob(db, 'job-1');
  assert.equal(partialJob.segments[0].status, 'done');
  assert.equal(partialJob.segments[1].status, 'failed');
  assert.equal(partialJob.segments[2].status, 'done');
  assert.equal(partialJob.status, 'failed');

  const mergeCalls = [];
  const retryResult = await retrySegment(db, 'job-1', 1, tmpDir, {
    generateFromSegment: async (_segmentPath, _chars, outputPath) => ({ outputPath }),
    mergeSegments: async (paths, outputPath) => {
      mergeCalls.push(paths);
      return { outputPath };
    },
  });

  assert.equal(retryResult.outputPath, path.join(tmpDir, 'generated-1.mp4'));
  assert.equal(mergeCalls.length, 1);
  assert.deepEqual(mergeCalls[0], [
    path.join(tmpDir, 'generated-0.mp4'),
    path.join(tmpDir, 'generated-1.mp4'),
    path.join(tmpDir, 'generated-2.mp4'),
  ]);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.resultPath, path.join(tmpDir, 'final.mp4'));
});
