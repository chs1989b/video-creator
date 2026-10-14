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
});

test('FLUX edits and narration are priced from the 10/14 measurements', () => {
  // FLUX: 1 credit per second, at most 15 (9.71 s → 9.71, 15.04 s → 15, 17.04 s → 15).
  assert.equal(estimateCredits('flux_3_video_edit', { seconds: 9.71 }), 9.71);
  assert.equal(estimateCredits('flux_3_video_edit', { seconds: 17.04 }), 15);
  // TTS: 0.15 per started 40 characters (39 → 0.15, 69 → 0.3, 117 → 0.45).
  assert.equal(estimateCredits('text2speech_v2', { characters: 39 }), 0.15);
  assert.equal(estimateCredits('text2speech_v2', { characters: 69 }), 0.3);
  assert.equal(estimateCredits('text2speech_v2', { characters: 117 }), 0.45);
  assert.equal(estimateCredits('text2speech_v2', { characters: 0 }), 0);
});

test('segment and video seconds come from the segment boundaries', () => {
  const job = { segments: [seg(0, 0, 5), seg(1, 5, 15), seg(2, 15, 30)] };
  assert.equal(segmentSeconds(job.segments[1]), 10);
  assert.equal(videoSeconds(job), 30);
  assert.equal(videoSeconds({ segments: [] }), 0);
  assert.equal(stageCredits(job, 'restyle'), 15);
  assert.equal(stageCredits({ ...job, script: '이 아이라이너는 한 번에 부드럽게 그려지고, 하루 종일 번지지 않아요.' }, 'voiceover'), 0.15);
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
    script: 'This eyeliner glides on smoothly in one stroke and stays put all day.',
  };
  const estimate = estimateRemaining(job);
  assert.deepEqual(estimate.items, [
    { stage: 'generate', credits: 175 },
    { stage: 'restyle', credits: 15 },
    { stage: 'voiceover', credits: 0.3 },
  ]);
  assert.equal(estimate.credits, 190.3);
  assert.equal(estimate.krw, 11418);
});

import { RESOLUTIONS, DEFAULT_RESOLUTION } from '../src/pipeline/costs.js';

test('the face swap is priced by resolution: 480p 3, 720p 7 credits per second (720p by default)', () => {
  assert.deepEqual(RESOLUTIONS, ['480p', '720p']);
  assert.equal(DEFAULT_RESOLUTION, '720p');
  assert.equal(estimateCredits('ad_multiplier', { seconds: 10, resolution: '480p' }), 30);
  assert.equal(estimateCredits('ad_multiplier', { seconds: 10, resolution: '720p' }), 70);
  assert.equal(estimateCredits('ad_multiplier', { seconds: 10 }), 70);
  assert.throws(() => estimateCredits('ad_multiplier', { seconds: 10, resolution: '4k' }), /resolution/);
});

test('estimateRemaining prices the remaining segments at the job\'s resolution', () => {
  const st = (status) => ({ status, outputPath: null, error: null });
  const job = {
    resolution: '480p',
    segments: [{ index: 0, startSeconds: 0, endSeconds: 5, status: 'done' }, { index: 1, startSeconds: 5, endSeconds: 30, status: 'pending' }],
    stages: { generate: st('pending'), merge: st('pending'), restyle: st('skipped'), edit: st('skipped'), voiceover: st('skipped') },
  };
  assert.deepEqual(estimateRemaining(job).items, [{ stage: 'generate', credits: 75 }]);
});
