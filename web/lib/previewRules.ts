import type { Attempt, Job, StageName } from './workerApi';
import { usedPreviews } from './workerApi';

export const latestAttempt = (job: Job | null): Attempt | undefined => job?.attempts[job.attempts.length - 1];

const lastIsSettled = (job: Job): boolean => {
  const latest = latestAttempt(job);
  return !latest || latest.status === 'failed' || latest.verdict === 'reject';
};

const openForPreviews = (job: Job): boolean =>
  job.previewRequired && job.status !== 'running' && !job.approvedAttemptId;

/** A new preview may start once the last one is judged (or failed) and the limit allows it. */
export function previewAllowed(job: Job): boolean {
  return openForPreviews(job) && lastIsSettled(job) && usedPreviews(job) < job.previewLimit;
}

/** At the limit, one more preview can be unlocked once the last one is judged. */
export function unlockAllowed(job: Job): boolean {
  return openForPreviews(job) && lastIsSettled(job) && usedPreviews(job) >= job.previewLimit;
}

export type PreviewStatus = { text: string; tone: 'idle' | 'active' | 'done' | 'failed' };

/** What the preview card says about the job right now. */
export function previewStatus(job: Job | null): PreviewStatus {
  if (!job) return { text: '입력을 채우고 5초 미리보기를 만드세요', tone: 'idle' };
  if (!job.previewRequired) return { text: '미리보기 없이 만든 작업', tone: 'idle' };
  if (job.status === 'running' && job.currentStage === 'preview') return { text: '5초 미리보기 만드는 중', tone: 'active' };
  if (job.approvedAttemptId) return { text: `승인됨 · 미리보기 ${usedPreviews(job)}회`, tone: 'done' };
  const latest = latestAttempt(job);
  // Downloading or splitting the source can fail before any preview exists.
  if (job.status === 'failed' && !latest) return { text: job.error ?? '영상 준비 실패', tone: 'failed' };
  if (latest?.status === 'failed') return { text: latest.error ?? '미리보기 실패', tone: 'failed' };
  return { text: `${usedPreviews(job)} / ${job.previewLimit}회 사용`, tone: job.attempts.length ? 'active' : 'idle' };
}

const INPUT_ORDER: StageName[] = ['restyle', 'edit', 'voiceover'];

/**
 * Can the prompt/script feeding this stage be edited now? Before a job exists,
 * yes; on a preview job, only after approval and until that stage (or a later
 * one) has run. Jobs made without previews keep their inputs locked, as before.
 */
export function inputEditable(job: Job | null, stage: 'restyle' | 'edit' | 'voiceover'): boolean {
  if (!job) return true;
  if (!job.previewRequired || !job.approvedAttemptId || job.status === 'running') return false;
  const ran = (s: StageName) => ['done', 'running'].includes(job.stages[s]?.status);
  return INPUT_ORDER.slice(INPUT_ORDER.indexOf(stage)).every((s) => !ran(s));
}
