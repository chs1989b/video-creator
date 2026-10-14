import { test, expect } from 'vitest';
import { previewAllowed, unlockAllowed, previewStatus, inputEditable, approvalWaitLabel } from '../lib/previewRules';
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
  previewRequired: true, mock: false, previewLimit: 5, attempts: [], approvedAttemptId: null,
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

test('the preview card explains a failure that happened before any preview existed', () => {
  const failedPrep = job({ status: 'failed', error: 'yt-dlp: unable to download', attempts: [] });
  expect(previewStatus(failedPrep)).toEqual({ text: 'yt-dlp: unable to download', tone: 'failed' });
  expect(previewStatus(job({ status: 'failed', error: null, attempts: [] }))).toEqual({ text: '영상 준비 실패', tone: 'failed' });
  expect(previewAllowed(failedPrep)).toBe(true); // the user can try again
});

test('the preview card states', () => {
  expect(previewStatus(null)).toEqual({ text: '입력을 채우고 5초 미리보기를 만드세요', tone: 'idle' });
  expect(previewStatus(job({ previewRequired: false }))).toEqual({ text: '미리보기 없이 만든 작업', tone: 'idle' });
  expect(previewStatus(job({ status: 'running', currentStage: 'preview' }))).toEqual({ text: '5초 미리보기 만드는 중', tone: 'active' });
  expect(previewStatus(job())).toEqual({ text: '0 / 5회 사용', tone: 'idle' });
  expect(previewStatus(job({ attempts: [attempt(1, 'failed')] }))).toEqual({ text: '미리보기 실패', tone: 'failed' });
  expect(previewStatus(job({ approvedAttemptId: 'a2', attempts: [attempt(1, 'done', 'reject'), attempt(2, 'done', 'approve')] })))
    .toEqual({ text: '승인됨 · 미리보기 2회', tone: 'done' });
});

test('optional inputs are editable before a job exists and after approval, until their stage (or a later one) runs', () => {
  const st = (status: string) => ({ status, outputPath: null, error: null }) as Job['stages']['generate'];
  const stages = (over: Partial<Record<string, string>> = {}) => ({
    generate: st('done'), merge: st('done'), restyle: st('skipped'), edit: st('skipped'), voiceover: st('skipped'),
    ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, st(v as string)])),
  }) as Job['stages'];
  const approved = (over = {}) => job({ approvedAttemptId: 'a1', stages: stages(over) });

  expect(inputEditable(null, 'voiceover')).toBe(true);
  expect(inputEditable(job({ stages: stages() }), 'voiceover')).toBe(false); // preview not approved yet
  expect(inputEditable(approved(), 'voiceover')).toBe(true);
  expect(inputEditable(approved({ voiceover: 'done' }), 'voiceover')).toBe(false);
  expect(inputEditable(approved({ edit: 'done' }), 'restyle')).toBe(false); // a later stage already ran
  expect(inputEditable(approved({ edit: 'done' }), 'voiceover')).toBe(true);
  expect(inputEditable(job({ approvedAttemptId: 'a1', status: 'running', stages: stages() }), 'voiceover')).toBe(false);
  expect(inputEditable(job({ previewRequired: false, stages: stages() }), 'voiceover')).toBe(false); // old jobs stay as before
});

test('while waiting for approval, the bottom button says what to do next on the preview card', () => {
  expect(approvalWaitLabel(job())).toBe('미리보기 카드에서 5초 미리보기를 만드세요');
  expect(approvalWaitLabel(job({ attempts: [attempt(1, 'done')] }))).toBe('미리보기를 보고 승인하거나 거절하세요');
  expect(approvalWaitLabel(job({ attempts: [attempt(1, 'done', 'reject')] }))).toBe('미리보기 카드에서 다음 미리보기를 만드세요');
  expect(approvalWaitLabel(job({ attempts: [attempt(1, 'failed')] }))).toBe('미리보기 카드에서 다음 미리보기를 만드세요');
  const fiveRejected = [1, 2, 3, 4, 5].map((n) => attempt(n, 'done', 'reject'));
  expect(approvalWaitLabel(job({ attempts: fiveRejected }))).toBe('미리보기 한도 도달 · 카드에서 1회 더 허용할 수 있습니다');
});
