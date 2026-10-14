import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob, updateJob } from '../src/pipeline/db.js';
import { runJob, runStage, retrySegment, nextStage, ensureSegments, resolveDeps, updateJobInputs } from '../src/pipeline/jobRunner.js';

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

test('a preview job refuses to generate before a preview is approved, without touching its state', async () => {
  const { db, tmpDir } = await setup({ previewRequired: true });

  await assert.rejects(runStage(db, 'job-1', tmpDir, 'generate', happyDeps()), /approve a preview/);
  await assert.rejects(runJob(db, 'job-1', tmpDir, happyDeps()), /approve a preview/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
  assert.equal(job.stages.generate.status, 'pending');
});

test('ensureSegments splits a preview job once, with a 5-second first segment', async () => {
  const { db, tmpDir } = await setup({ previewRequired: true });
  const splitCalls = [];
  const d = resolveDeps(happyDeps({
    splitIntoSegments: async (_src, _dir, size, opts) => { splitCalls.push({ size, opts }); return twoSegments(); },
  }));

  await ensureSegments(db, 'job-1', tmpDir, d);
  await ensureSegments(db, 'job-1', tmpDir, d);

  assert.deepEqual(splitCalls, [{ size: 10, opts: { firstSegmentSeconds: 5 } }]);
  const job = await getJob(db, 'job-1');
  assert.equal(job.segments.length, 2);
  assert.equal(job.segments[0].status, 'pending');
});

test('generate passes the approved prompt through and records each segment\'s credits', async () => {
  const { db, tmpDir } = await setup();
  await updateJob(db, 'job-1', { generatePrompt: 'Swap the face carefully.' });
  const prompts = [];
  const deps = happyDeps({
    generateFromSegment: async (_s, _c, outputPath, opts) => { prompts.push(opts.prompt); return { outputPath }; },
  });

  await runStage(db, 'job-1', tmpDir, 'generate', deps);

  assert.deepEqual(prompts, ['Swap the face carefully.', 'Swap the face carefully.']);
  const job = await getJob(db, 'job-1');
  assert.deepEqual(job.segments.map((s) => s.credits), [70, 35]);
});

test('finishing stages record their estimated credits', async () => {
  const { db, tmpDir } = await setup({ restylePrompt: 'Beige shirt.', script: 'Hi.' });

  await runJob(db, 'job-1', tmpDir, happyDeps());

  const job = await getJob(db, 'job-1');
  assert.equal(job.stages.restyle.credits, 15); // 15-second video -> 1/s, at most 15
  assert.equal(job.stages.voiceover.credits, 0.15); // 'Hi.' -> one 40-character unit
  assert.equal(job.stages.edit.credits ?? null, null); // skipped: nothing spent
});

test('optional inputs can be added or cleared after approval while their stage has not run', async () => {
  const { db, tmpDir } = await setup({ restylePrompt: 'Beige shirt.' });

  const job = await updateJobInputs(db, 'job-1', { script: '  Hi everyone.  ', restylePrompt: '' });

  assert.equal(job.script, 'Hi everyone.');
  assert.equal(job.stages.voiceover.status, 'pending');
  assert.equal(job.restylePrompt, null);
  assert.equal(job.stages.restyle.status, 'skipped');
  assert.equal(job.stages.edit.status, 'skipped'); // untouched

  await runJob(db, 'job-1', tmpDir, happyDeps());
  const done = await getJob(db, 'job-1');
  assert.equal(done.stages.voiceover.status, 'done');
});

test('inputs of a stage that ran, or that sits before a stage that ran, cannot change; nor while running', async () => {
  const { db, tmpDir } = await setup({ editPrompt: 'Warmer light.' });
  await runJob(db, 'job-1', tmpDir, happyDeps());

  await assert.rejects(updateJobInputs(db, 'job-1', { editPrompt: 'Cooler.' }), /already ran/);
  await assert.rejects(updateJobInputs(db, 'job-1', { restylePrompt: 'Red dress.' }), /already ran/);
  const same = await updateJobInputs(db, 'job-1', { editPrompt: 'Warmer light.' }); // unchanged is fine
  assert.equal(same.stages.edit.status, 'done');

  const added = await updateJobInputs(db, 'job-1', { script: 'New narration.' });
  assert.equal(added.stages.voiceover.status, 'pending');
  assert.equal(added.status, 'idle'); // a finished job reopens for the new stage
  assert.equal(nextStage(added), 'voiceover');

  await updateJob(db, 'job-1', { status: 'running' });
  await assert.rejects(updateJobInputs(db, 'job-1', { script: 'x' }), /already running/);
});

test('ensureSegments splits an uploaded source file without downloading anything', async () => {
  const { db, tmpDir } = await setup({ youtubeUrl: null });
  const uploaded = path.join(tmpDir, 'upload-abc.mov');
  await fs.writeFile(uploaded, 'fake video bytes');
  await updateJob(db, 'job-1', { sourceVideoPath: uploaded, sourceVideoName: 'my-review.mov' });
  let splitFrom = null;
  const d = resolveDeps(happyDeps({
    downloadVideo: async () => { throw new Error('must not download an uploaded source'); },
    splitIntoSegments: async (filePath) => { splitFrom = filePath; return twoSegments(); },
  }));

  const job = await ensureSegments(db, 'job-1', tmpDir, d);

  assert.equal(splitFrom, path.join(tmpDir, 'source.mov'));
  assert.equal(await fs.readFile(splitFrom, 'utf8'), 'fake video bytes');
  assert.equal(job.segments.length, 2);
});

test('the voice-over stage reads the script with the job\'s chosen voice', async () => {
  const { db, tmpDir } = await setup({ script: '안녕하세요.', voiceKey: 'male-1' });
  let used = null;
  await runJob(db, 'job-1', tmpDir, happyDeps({
    synthesizeSpeech: async (_t, outputPath, options) => { used = options?.voice; return { outputPath }; },
  }));
  assert.equal(used.voiceId, '6f98d3dd-324f-4845-8c28-c1d1647a06cd');
});

test('updateJobInputs changes the voice until the voice-over has run', async () => {
  const { db, tmpDir } = await setup({ script: 'Hi.' });
  assert.equal((await getJob(db, 'job-1')).voiceKey, 'female-1');
  assert.equal((await updateJobInputs(db, 'job-1', { voiceKey: 'female-2' })).voiceKey, 'female-2');
  await assert.rejects(updateJobInputs(db, 'job-1', { voiceKey: 'robot' }), /Unknown voice/);
  await runJob(db, 'job-1', tmpDir, happyDeps());
  await assert.rejects(updateJobInputs(db, 'job-1', { voiceKey: 'male-2' }), /already ran/);
});

test('retrySegment on a preview job needs an approved preview and never regenerates the approved one', async () => {
  const { db, tmpDir } = await setup();
  await updateJob(db, 'job-1', {
    previewRequired: true,
    segments: [
      { index: 0, path: '/tmp/s0.mp4', startSeconds: 0, endSeconds: 5, status: 'pending', resultPath: null, error: null, credits: null },
      { index: 1, path: '/tmp/s1.mp4', startSeconds: 5, endSeconds: 15, status: 'failed', resultPath: null, error: 'x', credits: 0 },
    ],
  });
  let calls = 0;
  const gen = { generateFromSegment: async (_s, _c, o) => { calls += 1; return { outputPath: o }; } };
  await assert.rejects(retrySegment(db, 'job-1', 1, tmpDir, gen), /approve a preview/);

  await updateJob(db, 'job-1', {
    approvedAttemptId: 'a1',
    segments: [
      { index: 0, path: '/tmp/s0.mp4', startSeconds: 0, endSeconds: 5, status: 'done', resultPath: '/tmp/preview-1.mp4', error: null, credits: 0, fromAttemptId: 'a1' },
      { index: 1, path: '/tmp/s1.mp4', startSeconds: 5, endSeconds: 15, status: 'failed', resultPath: null, error: 'x', credits: 0 },
    ],
  });
  await assert.rejects(retrySegment(db, 'job-1', 0, tmpDir, gen), /approved preview/);
  assert.equal(calls, 0);
  await retrySegment(db, 'job-1', 1, tmpDir, gen);
  assert.equal(calls, 1);
});
