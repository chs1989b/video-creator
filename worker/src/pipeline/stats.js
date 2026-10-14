import { PRICED_STAGES, toKrw } from './costs.js';

// The numbers behind "a finished video costs (one try) × (how many tries)":
// how many previews it took to approve, why previews were rejected, and what a
// finished video cost on average. Only preview-flow jobs count.

export const TARGET_KRW = 30000; // target cost of one finished video (course decision, 9/27)
export const REJECT_REASONS = ['얼굴', '제품', '동작', '배경', '기타'];

const round2 = (n) => Math.round(n * 100) / 100;
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Counted previews (failed ones are refunded and not counted) up to and including the approved one. */
function previewsToApproval(job) {
  const approved = job.attempts.find((a) => a.id === job.approvedAttemptId);
  if (!approved) return null;
  return job.attempts.filter((a) => a.status !== 'failed' && a.n <= approved.n).length;
}

function costOf(job) {
  const previewCredits = sum(job.attempts.map((a) => a.credits ?? 0));
  const restCredits = sum(job.segments.map((s) => s.credits ?? 0));
  const finishingCredits = sum(PRICED_STAGES.map((s) => job.stages?.[s]?.credits ?? 0));
  return { previewCredits, restCredits, finishingCredits };
}

export function jobStats(allJobs) {
  const jobs = allJobs.filter((j) => j.previewRequired).map((j) => ({ attempts: [], segments: [], ...j }));
  const toApproval = jobs.map(previewsToApproval).filter((n) => n !== null);
  const completed = jobs.filter((j) => j.status === 'done');

  const reasonCounts = Object.fromEntries(REJECT_REASONS.map((r) => [r, 0]));
  for (const a of jobs.flatMap((j) => j.attempts)) {
    if (a.verdict !== 'reject') continue;
    for (const r of a.reasons ?? []) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  // Most frequent first; ties keep the fixed reason order.
  const rejectReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  let avgCostPerCompleted = null;
  if (completed.length) {
    const costs = completed.map(costOf);
    const avg = (key) => round2(mean(costs.map((c) => c[key])));
    const parts = { previewCredits: avg('previewCredits'), restCredits: avg('restCredits'), finishingCredits: avg('finishingCredits') };
    const credits = round2(parts.previewCredits + parts.restCredits + parts.finishingCredits);
    avgCostPerCompleted = { ...parts, credits, krw: toKrw(credits) };
  }

  const avgPreviews = mean(toApproval);
  return {
    jobs: jobs.length,
    approved: toApproval.length,
    completed: completed.length,
    avgPreviewsToApproval: avgPreviews === null ? null : round2(avgPreviews),
    firstTryApprovalRate: toApproval.length ? round2(toApproval.filter((n) => n === 1).length / toApproval.length) : null,
    failedPreviews: jobs.flatMap((j) => j.attempts).filter((a) => a.status === 'failed').length,
    rejectReasons,
    avgCostPerCompleted,
    targetKrw: TARGET_KRW,
  };
}
