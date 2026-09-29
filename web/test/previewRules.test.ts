import { test, expect } from 'vitest';
import { previewAllowed, unlockAllowed } from '../lib/previewRules';
import type { Attempt, Job } from '../lib/workerApi';

const attempt = (n: number, status: Attempt['status'], verdict: Attempt['verdict'] = null): Attempt => ({
  id: `a${n}`, n, kind: 'preview', prompt: null, characterImagePath: '/c.png', productImagePath: null,
  segmentIndex: 0, status, outputPath: status === 'done' ? `/p${n}.mp4` : null, estimatedCredits: 35,
  credits: status === 'done' ? 35 : 0, verdict, reasons: [], error: null, createdAt: '', finishedAt: null,
});

const job = (patch: Partial<Job> = {}): Job => ({
  id: 'job-1', youtubeUrl: 'u', characterImagePaths: ['/c.png'], productImagePaths: [], script: null,
  restylePrompt: null, editPrompt: null, status: 'idle', currentStage: null,
  stages: {} as Job['stages'], segments: [], resultPath: null, error: null, createdAt: '',
  previewRequired: true, previewLimit: 5, attempts: [], approvedAttemptId: null,
  ...patch,
});

test('a new preview is allowed on a fresh preview job and after a rejection or a failure', () => {
  expect(previewAllowed(job())).toBe(true);
  expect(previewAllowed(job({ attempts: [attempt(1, 'done', 'reject')] }))).toBe(true);
  expect(previewAllowed(job({ attempts: [attempt(1, 'failed')] }))).toBe(true);
});

test('a new preview waits until the latest one is judged, and never runs on non-preview, running or approved jobs', () => {
  expect(previewAllowed(job({ attempts: [attempt(1, 'done')] }))).toBe(false);
  expect(previewAllowed(job({ previewRequired: false }))).toBe(false);
  expect(previewAllowed(job({ status: 'running' }))).toBe(false);
  expect(previewAllowed(job({ approvedAttemptId: 'a1', attempts: [attempt(1, 'done', 'approve')] }))).toBe(false);
});

test('the limit counts only previews that did not fail', () => {
  const fourRejectedOneFailed = [1, 2, 3, 4].map((n) => attempt(n, 'done', 'reject')).concat(attempt(5, 'failed'));
  expect(previewAllowed(job({ attempts: fourRejectedOneFailed }))).toBe(true);
  expect(unlockAllowed(job({ attempts: fourRejectedOneFailed }))).toBe(false);
});

test('at the limit, previews stop and one more can be unlocked once the last one is judged', () => {
  const fiveRejected = [1, 2, 3, 4, 5].map((n) => attempt(n, 'done', 'reject'));
  expect(previewAllowed(job({ attempts: fiveRejected }))).toBe(false);
  expect(unlockAllowed(job({ attempts: fiveRejected }))).toBe(true);

  const lastUnjudged = [1, 2, 3, 4].map((n) => attempt(n, 'done', 'reject')).concat(attempt(5, 'done'));
  expect(unlockAllowed(job({ attempts: lastUnjudged }))).toBe(false);
  expect(unlockAllowed(job({ attempts: fiveRejected, approvedAttemptId: 'a5' }))).toBe(false);
});
