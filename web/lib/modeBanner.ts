import type { Job } from './workerApi';

export type ModeBanner = { tone: 'mock' | 'real' | 'warn'; text: string };

const MOCK_TEXT = '테스트 모드 · 크레딧을 쓰지 않습니다 (결과는 원본 영상 그대로)';

/**
 * The banner next to the canvas title. It follows the loaded job's own mode,
 * not the worker's: a real Higgsfield job opened while the worker runs in test
 * mode must not look like a test run. With no job loaded it shows the worker's
 * mode. An unfinished job whose mode differs from the worker's cannot continue
 * (the worker answers 409), so that case says so.
 */
export function modeBanner(workerMock: boolean, job: Pick<Job, 'mock' | 'status'> | null): ModeBanner | null {
  if (!job) return workerMock ? { tone: 'mock', text: MOCK_TEXT } : null;
  const finished = job.status === 'done';
  if (job.mock !== workerMock && !finished) {
    return {
      tone: 'warn',
      text: job.mock
        ? '테스트 작업 · 지금 워커는 실제 모드라 이어서 실행할 수 없습니다'
        : '실제 생성 작업 · 지금 워커는 테스트 모드라 이어서 실행할 수 없습니다',
    };
  }
  if (job.mock) return { tone: 'mock', text: MOCK_TEXT };
  return workerMock ? { tone: 'real', text: '실제 생성 작업 · Higgsfield로 만든 결과입니다' } : null;
}
