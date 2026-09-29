import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob } from '../src/pipeline/db.js';
import { runJob, runStage, retrySegment, nextStage } from '../src/pipeline/jobRunner.js';

async function setup(extra = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobrunner-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-1',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
    ...extra,
  });
  return { db, tmpDir };
}

const twoSegments = async () => [
  { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
  { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 10, endSeconds: 15 },
];

function happyDeps(overrides = {}) {
  return {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: twoSegments,
    generateFromSegment: async (_s, _c, outputPath) => ({ outputPath }),
    mergeSegments: async (_p, outputPath) => ({ outputPath }),
    editVideo: async (_v, _p, outputPath) => ({ outputPath }),
    synthesizeSpeech: async (_t, outputPath) => ({ outputPath }),
    muxVoiceover: async (_v, _a, outputPath) => ({ outputPath }),
    ...overrides,
  };
}

test('a new job starts idle with generate/merge pending and optional stages skipped', async () => {
  const { db } = await setup({ script: 'Hi' });
  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
  assert.equal(job.stages.generate.status, 'pending');
  assert.equal(job.stages.merge.status, 'pending');
  assert.equal(job.stages.restyle.status, 'skipped');
  assert.equal(job.stages.edit.status, 'skipped');
  assert.equal(job.stages.voiceover.status, 'pending');
  assert.equal(nextStage(job), 'generate');
});

test('runJob walks every enabled stage in order and records each output', async () => {
  const { db, tmpDir } = await setup({
    script: 'Narration.',
    restylePrompt: 'Beige shirt.',
    editPrompt: 'Warmer light.',
  });
  const order = [];
  const deps = happyDeps({
    mergeSegments: async (paths, outputPath) => { order.push(['merge', paths.length]); return { outputPath }; },
    editVideo: async (videoPath, prompt, outputPath) => { order.push(['edit', path.basename(videoPath), prompt]); return { outputPath }; },
    muxVoiceover: async (videoPath, _a, outputPath) => { order.push(['mux', path.basename(videoPath)]); return { outputPath }; },
  });

  const result = await runJob(db, 'job-1', tmpDir, deps);

  assert.deepEqual(order, [
    ['merge', 2],
    ['edit', 'final.mp4', 'Beige shirt.'],
    ['edit', 'final-restyled.mp4', 'Warmer light.'],
    ['mux', 'final-edited.mp4'],
  ]);
  assert.equal(result.resultPath, path.join(tmpDir, 'final-voiced.mp4'));
  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.stages.generate.status, 'done');
  assert.equal(job.stages.merge.outputPath, path.join(tmpDir, 'final.mp4'));
  assert.equal(job.stages.restyle.outputPath, path.join(tmpDir, 'final-restyled.mp4'));
  assert.equal(job.stages.edit.outputPath, path.join(tmpDir, 'final-edited.mp4'));
  assert.equal(job.stages.voiceover.outputPath, path.join(tmpDir, 'final-voiced.mp4'));
  assert.equal(job.error, null);
});

test('runJob with only the required stages ends at the merged file', async () => {
  const { db, tmpDir } = await setup();
  const result = await runJob(db, 'job-1', tmpDir, happyDeps({
    editVideo: async () => { throw new Error('should not be called'); },
    synthesizeSpeech: async () => { throw new Error('should not be called'); },
  }));
  assert.equal(result.resultPath, path.join(tmpDir, 'final.mp4'));
});

test('a failing segment marks the generate stage and the job failed, without merging', async () => {
  const { db, tmpDir } = await setup();
  const deps = happyDeps({
    generateFromSegment: async (segmentPath, _c, outputPath) => {
      if (segmentPath === '/tmp/segment-001.mp4') throw new Error('higgsfield call failed');
      return { outputPath };
    },
    mergeSegments: async () => { throw new Error('should not be called'); },
  });

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /1 segment\(s\) failed to generate/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.currentStage, null);
  assert.equal(job.stages.generate.status, 'failed');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[1].status, 'failed');
  assert.equal(job.segments[1].error, 'higgsfield call failed');
  assert.equal(job.stages.merge.status, 'pending');
});

test('resuming a failed job regenerates only the failed segment and continues to the end', async () => {
  const { db, tmpDir } = await setup({ script: 'Hi' });
  let calls = 0;
  const flaky = happyDeps({
    generateFromSegment: async (segmentPath, _c, outputPath) => {
      calls += 1;
      if (segmentPath === '/tmp/segment-001.mp4' && calls <= 2) throw new Error('boom');
      return { outputPath };
    },
  });
  await assert.rejects(runJob(db, 'job-1', tmpDir, flaky));
  assert.equal(calls, 2);

  const generated = [];
  const resumed = happyDeps({
    downloadVideo: async () => { throw new Error('must not download again'); },
    splitIntoSegments: async () => { throw new Error('must not split again'); },
    generateFromSegment: async (segmentPath, _c, outputPath) => { generated.push(segmentPath); return { outputPath }; },
  });
  const result = await runJob(db, 'job-1', tmpDir, resumed);

  assert.deepEqual(generated, ['/tmp/segment-001.mp4'], 'the done segment is not billed again');
  assert.equal(result.resultPath, path.join(tmpDir, 'final-voiced.mp4'));
  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.error, null, 'the earlier failure message is cleared once the job completes');
});

test('a failure in a finishing stage leaves the job failed (never stuck running) and resumes from that stage', async () => {
  const { db, tmpDir } = await setup({ restylePrompt: 'Beige.', editPrompt: 'Warm.' });
  let editCalls = 0;
  const deps = happyDeps({
    editVideo: async (_v, prompt, outputPath) => {
      editCalls += 1;
      if (prompt === 'Warm.' && editCalls === 2) throw new Error('request failed (no response received)');
      return { outputPath };
    },
  });

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /no response received/);
  let job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.stages.restyle.status, 'done');
  assert.equal(job.stages.edit.status, 'failed');
  assert.match(job.stages.edit.error, /no response received/);
  assert.equal(nextStage(job), 'edit');

  const result = await runJob(db, 'job-1', tmpDir, deps);
  assert.equal(editCalls, 3, 'restyle was not re-rendered; only the edit ran again');
  assert.equal(result.resultPath, path.join(tmpDir, 'final-edited.mp4'));
  job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
});

test('runStage runs a single stage and leaves the job idle when more stages remain', async () => {
  const { db, tmpDir } = await setup({ script: 'Hi' });
  const deps = happyDeps();

  await runStage(db, 'job-1', tmpDir, 'generate', deps);
  let job = await getJob(db, 'job-1');
  assert.equal(job.stages.generate.status, 'done');
  assert.equal(job.status, 'idle');
  assert.equal(job.resultPath, null);

  await runStage(db, 'job-1', tmpDir, 'merge', deps);
  job = await getJob(db, 'job-1');
  assert.equal(job.stages.merge.status, 'done');
  assert.equal(job.status, 'idle');

  await runStage(db, 'job-1', tmpDir, 'voiceover', deps);
  job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.resultPath, path.join(tmpDir, 'final-voiced.mp4'));
});

test('runStage refuses a stage whose predecessors are not done, and a skipped stage', async () => {
  const { db, tmpDir } = await setup();
  await assert.rejects(runStage(db, 'job-1', tmpDir, 'merge', happyDeps()), /earlier stages/);
  await assert.rejects(runStage(db, 'job-1', tmpDir, 'restyle', happyDeps()), /skipped/);
  await assert.rejects(runStage(db, 'job-1', tmpDir, 'bogus', happyDeps()), /Unknown stage/);
});

test('retrySegment regenerates one segment and marks generate done once all segments are', async () => {
  const { db, tmpDir } = await setup();
  await assert.rejects(runJob(db, 'job-1', tmpDir, happyDeps({
    generateFromSegment: async () => { throw new Error('boom'); },
  })));

  await assert.rejects(retrySegment(db, 'job-1', 0, tmpDir, {
    generateFromSegment: async () => { throw new Error('still boom'); },
  }), /still boom/);
  let job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.stages.generate.status, 'failed');

  await retrySegment(db, 'job-1', 0, tmpDir, { generateFromSegment: async (_s, _c, o) => ({ outputPath: o }) });
  job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[0].error, null);
  assert.equal(job.stages.generate.status, 'failed', 'segment 1 is still failed');
  assert.equal(job.status, 'idle');

  await retrySegment(db, 'job-1', 1, tmpDir, { generateFromSegment: async (_s, _c, o) => ({ outputPath: o }) });
  job = await getJob(db, 'job-1');
  assert.equal(job.stages.generate.status, 'done');
  assert.equal(nextStage(job), 'merge');
});

test('runJob and runStage refuse to start while the job is already running', async () => {
  const { db, tmpDir } = await setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  const deps = happyDeps({ downloadVideo: async () => { await gate; return { filePath: '/tmp/source.mp4' }; } });

  const running = runJob(db, 'job-1', tmpDir, deps);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /already running/);
  await assert.rejects(runStage(db, 'job-1', tmpDir, 'generate', deps), /already running/);
  release();
  await running;
});
