import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobStats, TARGET_KRW } from '../src/pipeline/stats.js';

const attempt = (n, { status = 'done', verdict = null, reasons = [], credits = 35 } = {}) =>
  ({ id: `a${n}`, n, status, verdict, reasons, credits: status === 'failed' ? 0 : credits });
const stage = (status, credits) => ({ status, outputPath: null, error: null, ...(credits !== undefined ? { credits } : {}) });

function job(id, { attempts = [], approved = null, status = 'idle', segments = [], stages = {}, previewRequired = true } = {}) {
  return {
    id, previewRequired, status, attempts, approvedAttemptId: approved, segments,
    stages: { generate: stage('pending'), merge: stage('pending'), restyle: stage('skipped'), edit: stage('skipped'), voiceover: stage('skipped'), ...stages },
  };
}

test('jobStats counts previews to approval (failed ones excluded) and the first-try rate', () => {
  const stats = jobStats([
    // approved on the 3rd counted preview (a failed one in between does not count)
    job('A', { approved: 'a4', attempts: [
      attempt(1, { verdict: 'reject', reasons: ['얼굴'] }),
      attempt(2, { status: 'failed' }),
      attempt(3, { verdict: 'reject', reasons: ['얼굴', '제품'] }),
      attempt(4, { verdict: 'approve' }),
    ] }),
    job('B', { approved: 'a1', attempts: [attempt(1, { verdict: 'approve' })] }),
    job('C', { attempts: [attempt(1, { verdict: 'reject', reasons: ['배경'] })] }), // not approved yet
    job('Old', { previewRequired: false }), // made before previews: ignored
  ]);
  assert.equal(stats.jobs, 3);
  assert.equal(stats.approved, 2);
  assert.equal(stats.avgPreviewsToApproval, 2); // (3 + 1) / 2
  assert.equal(stats.firstTryApprovalRate, 0.5);
  assert.equal(stats.failedPreviews, 1);
  assert.deepEqual(stats.rejectReasons, [
    { reason: '얼굴', count: 2 }, { reason: '제품', count: 1 }, { reason: '배경', count: 1 },
    { reason: '동작', count: 0 }, { reason: '기타', count: 0 },
  ]);
});

test('jobStats averages what a finished video cost, split into previews, the rest and the optional stages', () => {
  const done = (id, previews, segCredits, restyle) => job(id, {
    status: 'done', approved: 'a1',
    attempts: Array.from({ length: previews }, (_, i) => attempt(i + 1, { verdict: i === previews - 1 ? 'approve' : 'reject' })),
    segments: [{ credits: 0 }, { credits: segCredits }],
    stages: { generate: stage('done'), merge: stage('done'), restyle: restyle ? stage('done', restyle) : stage('skipped') },
  });
  const stats = jobStats([done('X', 1, 175, 45), done('Y', 3, 175, 0)]);
  assert.equal(stats.completed, 2);
  assert.deepEqual(stats.avgCostPerCompleted, {
    previewCredits: 70, restCredits: 175, finishingCredits: 22.5, credits: 267.5, krw: 16050,
  });
  assert.equal(stats.targetKrw, TARGET_KRW);
  assert.equal(TARGET_KRW, 30000);
});

test('jobStats with no jobs returns zeros and nulls, never NaN', () => {
  const stats = jobStats([]);
  assert.equal(stats.jobs, 0);
  assert.equal(stats.avgPreviewsToApproval, null);
  assert.equal(stats.firstTryApprovalRate, null);
  assert.equal(stats.avgCostPerCompleted, null);
  assert.equal(stats.rejectReasons.every((r) => r.count === 0), true);
});
