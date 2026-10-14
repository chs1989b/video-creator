import { expect, it } from 'vitest';
import { modeBanner } from '../lib/modeBanner';

const job = (mock: boolean, status: 'idle' | 'running' | 'done' | 'failed' = 'idle') => ({ mock, status });

it('with no job loaded, follows the worker: test mode shows the banner, real mode shows nothing', () => {
  expect(modeBanner(true, null)).toEqual({ tone: 'mock', text: '테스트 모드 · 크레딧을 쓰지 않습니다 (결과는 원본 영상 그대로)' });
  expect(modeBanner(false, null)).toBeNull();
});

it('a test job is labelled as a test job whatever mode the worker is in', () => {
  expect(modeBanner(true, job(true))?.tone).toBe('mock');
  expect(modeBanner(false, job(true, 'done'))?.tone).toBe('mock');
});

it('a real job opened on a test-mode worker is labelled real, not test', () => {
  expect(modeBanner(true, job(false, 'done'))).toEqual({ tone: 'real', text: '실제 생성 작업 · Higgsfield로 만든 결과입니다' });
});

it('a real job on a real worker needs no banner', () => {
  expect(modeBanner(false, job(false))).toBeNull();
  expect(modeBanner(false, job(false, 'done'))).toBeNull();
});

it('warns when an unfinished job cannot continue on this worker', () => {
  expect(modeBanner(true, job(false, 'idle'))).toEqual({
    tone: 'warn',
    text: '실제 생성 작업 · 지금 워커는 테스트 모드라 이어서 실행할 수 없습니다',
  });
  expect(modeBanner(false, job(true, 'failed'))).toEqual({
    tone: 'warn',
    text: '테스트 작업 · 지금 워커는 실제 모드라 이어서 실행할 수 없습니다',
  });
});
