import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_KRW, PREVIEW_SECONDS, PREVIEW_LIMIT,
  estimateCredits, segmentSeconds, videoSeconds, stageCredits, toKrw, jobTotals, estimateRemaining,
} from '../src/pipeline/costs.js';

const seg = (index, startSeconds, endSeconds, extra = {}) => ({ index, startSeconds, endSeconds, status: 'pending', ...extra });
const stage = (status, extra = {}) => ({ status, outputPath: null, error: null, ...extra });

test('constants match the Plus plan and the 5-second, 5-attempt preview policy', () => {
  assert.equal(CREDIT_KRW, 60);
  assert.equal(PREVIEW_SECONDS, 5);
  assert.equal(PREVIEW_LIMIT, 5);
});

test('estimateCredits prices each model by its unit', () => {
  assert.equal(estimateCredits('ad_multiplier', { seconds: 5 }), 35);
  assert.equal(estimateCredits('ad_multiplier', { seconds: 10 }), 70);
  assert.equal(estimateCredits('flux_3_video_edit', { seconds: 15 }), 30);
  assert.equal(estimateCredits('text2speech_v2'), 0.45);
});

test('segment and video seconds come from the segment boundaries', () => {
  const job = { segments: [seg(0, 0, 5), seg(1, 5, 15), seg(2, 15, 30)] };
  assert.equal(segmentSeconds(job.segments[1]), 10);
  assert.equal(videoSeconds(job), 30);
  assert.equal(videoSeconds({ segments: [] }), 0);
  assert.equal(stageCredits(job, 'restyle'), 45);
  assert.equal(stageCredits(job, 'voiceover'), 0.45);
});

test('jobTotals adds previews, generated segments and finishing stages without double-counting the approved preview', () => {
  const job = {
    attempts: [{ credits: 35 }, { credits: 0 }, { credits: 35 }],
    segments: [seg(0, 0, 5, { credits: 0, fromAttemptId: 'a3' }), seg(1, 5, 15, { credits: 70 }), seg(2, 15, 25, { credits: 70 }), seg(3, 25, 30, { credits: 35 })],
    stages: { generate: stage('done'), merge: stage('done'), restyle: stage('done', { credits: 45 }), edit: stage('skipped'), voiceover: stage('done', { credits: 0.45 }) },
  };
  assert.deepEqual(jobTotals(job), { previews: 3, credits: 290.45, krw: 17427 });
  assert.equal(toKrw(350), 21000);
});

test('estimateRemaining prices only what has not run yet', () => {
  const job = {
    segments: [seg(0, 0, 5, { status: 'done' }), seg(1, 5, 15), seg(2, 15, 30)],
    stages: { generate: stage('pending'), merge: stage('pending'), restyle: stage('pending'), edit: stage('skipped'), voiceover: stage('pending') },
  };
  const estimate = estimateRemaining(job);
  assert.deepEqual(estimate.items, [
    { stage: 'generate', credits: 175 },
    { stage: 'restyle', credits: 45 },
    { stage: 'voiceover', credits: 0.45 },
  ]);
  assert.equal(estimate.credits, 220.45);
  assert.equal(estimate.krw, 13227);
});
