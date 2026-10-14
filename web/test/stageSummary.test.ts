import { expect, it } from 'vitest';
import { summarize } from '../components/nodes/StageNode';
import type { Job } from '../lib/workerApi';

const job = (restyle: string, patch: Partial<Job> = {}): Job => ({
  id: 'job-1', youtubeUrl: 'u', characterImagePaths: ['/c.png'], productImagePaths: [], script: null,
  restylePrompt: null, editPrompt: null, status: 'idle', currentStage: null,
  stages: { generate: { status: 'done' }, merge: { status: 'done' }, restyle: { status: restyle } } as unknown as Job['stages'],
  segments: [], resultPath: null, error: null, createdAt: '', previewRequired: true, mock: true, previewLimit: 5,
  attempts: [], approvedAttemptId: 'a1', ...patch,
});

it('a skipped stage whose prompt was just typed on screen will run with it', () => {
  expect(summarize('restyle', job('skipped'), true)).toEqual({ text: '실행하면 입력한 내용으로 진행합니다', tone: 'idle' });
  expect(summarize('restyle', job('skipped'), false).text).toBe('입력이 없어 건너뜁니다');
});

it('a pending stage whose prompt was cleared on screen will be skipped', () => {
  expect(summarize('restyle', job('pending'), false)).toEqual({ text: '입력을 비워 건너뜁니다', tone: 'idle' });
  expect(summarize('restyle', job('pending'), true).text).not.toBe('입력을 비워 건너뜁니다');
});

it('a stage that already ran ignores the screen input', () => {
  expect(summarize('restyle', job('done'), false).text).toBe('완료 · 저장됨');
  const laterRan = job('skipped');
  laterRan.stages.voiceover = { status: 'done' } as Job['stages']['voiceover'];
  expect(summarize('restyle', laterRan, true).text).toBe('입력이 없어 건너뜁니다');
});
