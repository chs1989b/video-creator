import { expect, it } from 'vitest';
import { historyRow } from '../lib/jobHistory';
import type { Job } from '../lib/workerApi';

process.env.TZ = 'Asia/Seoul';

const base = {
  id: 'dd0be539-0583-4d5e-88bf-3352f450e4bd', youtubeUrl: 'u', characterImagePaths: [], productImagePaths: [],
  script: null, restylePrompt: null, editPrompt: null, currentStage: null, stages: {} as Job['stages'], segments: [],
  resultPath: null, error: null, createdAt: '2026-10-08T05:00:00.000Z', previewRequired: true, mock: true,
  previewLimit: 5, attempts: [], approvedAttemptId: null, finishedAt: null,
  totals: { previews: 2, credits: 184.73, krw: 11084 },
} as unknown as Job;

it('describes a finished job with times, duration and cost', () => {
  const row = historyRow({ ...base, status: 'done', approvedAttemptId: 'a2', finishedAt: '2026-10-08T05:03:30.000Z' });
  expect(row).toMatchObject({
    id: base.id, shortId: 'dd0be539', status: '완성', tone: 'done',
    started: '10/08 14:00', finished: '10/08 14:03', duration: '3분 30초',
    cost: '실제였다면 184.73크레딧 · 약 11,084원', mock: true,
  });
});

it('names where an unfinished job is', () => {
  expect(historyRow({ ...base, status: 'idle' })).toMatchObject({ status: '미리보기 2회 · 승인 전', tone: 'active', finished: '—', duration: null });
  expect(historyRow({ ...base, status: 'idle', approvedAttemptId: 'a1' })).toMatchObject({ status: '승인됨 · 실행 전', tone: 'active' });
  expect(historyRow({ ...base, status: 'running' })).toMatchObject({ status: '진행 중', tone: 'active' });
  expect(historyRow({ ...base, status: 'failed', finishedAt: '2026-10-08T05:00:20.000Z' })).toMatchObject({ status: '실패', tone: 'failed', duration: '20초' });
  expect(historyRow({ ...base, status: 'idle', mock: false, totals: { previews: 0, credits: 0, krw: 0 } }).cost).toBe('0크레딧');
});
