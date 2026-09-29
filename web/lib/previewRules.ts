import type { Attempt, Job } from './workerApi';
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
