import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob } from '../src/pipeline/db.js';
import { runStage } from '../src/pipeline/jobRunner.js';
import { runPreview, recordVerdict, unlockPreview, previewBlocker, usedPreviews } from '../src/pipeline/preview.js';

async function setup(extra = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-1', youtubeUrl: 'https://example.com/v.mp4', characterImagePaths: ['/tmp/char.png'],
    productImagePaths: ['/tmp/product.png'], previewRequired: true, ...extra,
  });
  return { db, tmpDir };
}

const threeSegments = async () => [
  { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 5 },
  { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 5, endSeconds: 15 },
  { index: 2, path: '/tmp/segment-002.mp4', startSeconds: 15, endSeconds: 25 },
];

function deps(generated = [], overrides = {}) {
  return {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: threeSegments,
    generateFromSegment: async (segmentPath, characterImagePath, outputPath, opts) => {
      generated.push({ segmentPath, characterImagePath, outputPath, ...opts });
      return { outputPath };
    },
    ...overrides,
  };
}

test('runPreview generates only the first 5-second segment and records the attempt', async () => {
  const { db, tmpDir } = await setup();
  const generated = [];

  const attempt = await runPreview(db, 'job-1', tmpDir, { prompt: 'Keep her smile.' }, deps(generated));

  assert.equal(generated.length, 1);
  assert.equal(generated[0].segmentPath, '/tmp/segment-000.mp4');
  assert.equal(generated[0].outputPath, path.join(tmpDir, 'preview-1.mp4'));
  assert.equal(generated[0].prompt, 'Keep her smile.');
  assert.equal(generated[0].productImagePath, '/tmp/product.png');
  assert.equal(attempt.id, 'a1');
  assert.equal(attempt.status, 'done');
  assert.equal(attempt.credits, 35);
  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
  assert.equal(job.attempts.length, 1);
  assert.equal(job.segments[0].status, 'pending'); // not reused until approved
});

test('a preview can use a different person photo than the job was created with', async () => {
  const { db, tmpDir } = await setup();
  const generated = [];

  await runPreview(db, 'job-1', tmpDir, { characterImagePath: '/tmp/other.png' }, deps(generated));

  assert.equal(generated[0].characterImagePath, '/tmp/other.png');
  const job = await getJob(db, 'job-1');
  assert.equal(job.attempts[0].characterImagePath, '/tmp/other.png');
});

test('a failed preview costs nothing, marks the job failed, and does not count toward the limit', async () => {
  const { db, tmpDir } = await setup();
  const failing = deps([], { generateFromSegment: async () => { throw new Error('nsfw'); } });

  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, failing), /nsfw/);

  let job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts[0].status, 'failed');
  assert.equal(job.attempts[0].credits, 0);
  assert.equal(usedPreviews(job), 0);

  const next = await runPreview(db, 'job-1', tmpDir, {}, deps());
  assert.equal(next.n, 2);
  job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
});

test('the sixth preview is blocked until one more is unlocked, and only one', async () => {
  const { db, tmpDir } = await setup();
  for (let i = 0; i < 5; i += 1) {
    const a = await runPreview(db, 'job-1', tmpDir, {}, deps());
    await recordVerdict(db, 'job-1', a.id, { verdict: 'reject', reasons: ['얼굴'] });
  }

  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /limit/);
  assert.match(previewBlocker(await getJob(db, 'job-1')), /limit/);

  await unlockPreview(db, 'job-1');
  await runPreview(db, 'job-1', tmpDir, {}, deps());
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /limit/);
});

test('rejecting keeps the job unapproved and stores the reasons', async () => {
  const { db, tmpDir } = await setup();
  const a = await runPreview(db, 'job-1', tmpDir, {}, deps());

  const job = await recordVerdict(db, 'job-1', a.id, { verdict: 'reject', reasons: ['제품', '동작'] });

  assert.equal(job.approvedAttemptId, null);
  assert.equal(job.attempts[0].verdict, 'reject');
  assert.deepEqual(job.attempts[0].reasons, ['제품', '동작']);
});

test('approving reuses the preview as segment 0 and the remaining generation uses its settings', async () => {
  const { db, tmpDir } = await setup();
  await runPreview(db, 'job-1', tmpDir, { prompt: 'First try.' }, deps());
  const second = await runPreview(db, 'job-1', tmpDir, { prompt: 'Second try.', characterImagePath: '/tmp/b.png' }, deps());

  const approved = await recordVerdict(db, 'job-1', second.id, { verdict: 'approve' });

  assert.equal(approved.approvedAttemptId, 'a2');
  assert.equal(approved.generatePrompt, 'Second try.');
  assert.deepEqual(approved.characterImagePaths, ['/tmp/b.png']);
  assert.equal(approved.segments[0].status, 'done');
  assert.equal(approved.segments[0].resultPath, path.join(tmpDir, 'preview-2.mp4'));
  assert.equal(approved.segments[0].credits, 0);

  const generated = [];
  await runStage(db, 'job-1', tmpDir, 'generate', deps(generated));
  assert.deepEqual(generated.map((g) => g.segmentPath), ['/tmp/segment-001.mp4', '/tmp/segment-002.mp4']);
  assert.deepEqual(generated.map((g) => g.prompt), ['Second try.', 'Second try.']);
  assert.deepEqual(generated.map((g) => g.characterImagePath), ['/tmp/b.png', '/tmp/b.png']);
});

test('only a finished preview can be approved, only once, and no preview runs after approval', async () => {
  const { db, tmpDir } = await setup();
  await assert.rejects(
    runPreview(db, 'job-1', tmpDir, {}, deps([], { generateFromSegment: async () => { throw new Error('failed'); } })),
  );
  await assert.rejects(recordVerdict(db, 'job-1', 'a1', { verdict: 'approve' }), /finished/);
  await assert.rejects(recordVerdict(db, 'job-1', 'a9', { verdict: 'approve' }), /not found/);

  const ok = await runPreview(db, 'job-1', tmpDir, {}, deps());
  await recordVerdict(db, 'job-1', ok.id, { verdict: 'approve' });

  await assert.rejects(recordVerdict(db, 'job-1', ok.id, { verdict: 'approve' }), /already approved/);
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /already approved/);
  await assert.rejects(recordVerdict(db, 'job-1', ok.id, { verdict: 'maybe' }), /Unknown verdict/);
});

test('a job created without previews refuses preview calls', async () => {
  const { db, tmpDir } = await setup({ previewRequired: false });
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /does not use previews/);
});

test('unlock is refused unless a preview job has used up its limit, and never after approval', async () => {
  const { db, tmpDir } = await setup();
  await assert.rejects(unlockPreview(db, 'job-1'), /limit/);

  for (let i = 0; i < 5; i += 1) {
    const a = await runPreview(db, 'job-1', tmpDir, {}, deps());
    await recordVerdict(db, 'job-1', a.id, { verdict: 'reject' });
  }
  const unlocked = await unlockPreview(db, 'job-1');
  assert.equal(unlocked.previewLimit, 6);
  await assert.rejects(unlockPreview(db, 'job-1'), /limit/); // still below the new limit

  const sixth = await runPreview(db, 'job-1', tmpDir, {}, deps());
  await recordVerdict(db, 'job-1', sixth.id, { verdict: 'approve' });
  await assert.rejects(unlockPreview(db, 'job-1'), /approved/);

  const { db: plainDb } = await setup({ previewRequired: false });
  await assert.rejects(unlockPreview(plainDb, 'job-1'), /does not use previews/);
});
