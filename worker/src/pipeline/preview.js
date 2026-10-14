import path from 'node:path';
import { getJob, updateJob } from './db.js';
import { ensureSegments, resolveDeps } from './jobRunner.js';
import { estimateCredits, segmentSeconds } from './costs.js';

// A preview generates only the first (5-second) segment, so the expensive
// full generation runs once, after the user approves a look. The approved
// preview becomes segment 0 as-is; stageGenerate then skips it.

async function requireJob(db, jobId) {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

async function patchAttempt(db, jobId, attemptId, patch) {
  const job = await requireJob(db, jobId);
  const attempts = job.attempts.map((a) => (a.id === attemptId ? { ...a, ...patch } : a));
  await updateJob(db, jobId, { attempts });
}

/** Failed previews are refunded and do not use up the limit. */
export function usedPreviews(job) {
  return job.attempts.filter((a) => a.status !== 'failed').length;
}

/** Why a preview cannot start right now, or null when it can. */
export function previewBlocker(job) {
  if (!job.previewRequired) return 'this job does not use previews';
  if (job.status === 'running') return 'job is already running';
  if (job.approvedAttemptId) return 'a preview is already approved; start a new job to change settings';
  if (usedPreviews(job) >= job.previewLimit) return `preview limit reached (${job.previewLimit})`;
  return null;
}

export async function runPreview(
  db,
  jobId,
  workDir,
  { prompt = null, characterImagePath = null, productImagePath = null } = {},
  deps = {},
) {
  const d = resolveDeps(deps);
  let job = await requireJob(db, jobId);
  const blocker = previewBlocker(job);
  if (blocker) throw new Error(blocker);

  await updateJob(db, jobId, { status: 'running', currentStage: 'preview', error: null });
  try {
    job = await ensureSegments(db, jobId, workDir, d);
  } catch (error) {
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }

  const segment = job.segments[0];
  const n = job.attempts.length + 1;
  const attempt = {
    id: `a${n}`,
    n,
    kind: 'preview',
    prompt,
    characterImagePath: characterImagePath ?? job.characterImagePaths[0],
    productImagePath: productImagePath ?? job.productImagePaths?.[0] ?? null,
    segmentIndex: segment.index,
    status: 'running',
    outputPath: null,
    estimatedCredits: estimateCredits('ad_multiplier', { seconds: segmentSeconds(segment), resolution: job.resolution }),
    credits: null,
    verdict: null,
    reasons: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  await updateJob(db, jobId, { attempts: [...job.attempts, attempt] });

  const outputPath = path.join(workDir, `preview-${n}.mp4`);
  try {
    await d.generateFromSegment(segment.path, attempt.characterImagePath, outputPath, {
      productImagePath: attempt.productImagePath,
      prompt,
      resolution: job.resolution,
    });
    const done = { status: 'done', outputPath, credits: attempt.estimatedCredits, finishedAt: new Date().toISOString() };
    await patchAttempt(db, jobId, attempt.id, done);
    await updateJob(db, jobId, { status: 'idle', currentStage: null });
    return { ...attempt, ...done };
  } catch (error) {
    await patchAttempt(db, jobId, attempt.id, {
      status: 'failed', credits: 0, error: error.message, finishedAt: new Date().toISOString(),
    });
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }
}

export async function recordVerdict(db, jobId, attemptId, { verdict, reasons = [] } = {}) {
  if (!['approve', 'reject'].includes(verdict)) throw new Error(`Unknown verdict: ${verdict}`);
  const job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('job is already running');
  const attempt = job.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
  if (job.approvedAttemptId) throw new Error('a preview is already approved');
  if (attempt.status !== 'done') throw new Error('only a finished preview can be judged');

  const attempts = job.attempts.map((a) => (a.id === attemptId ? { ...a, verdict, reasons } : a));
  if (verdict === 'reject') {
    await updateJob(db, jobId, { attempts });
    return requireJob(db, jobId);
  }

  // The approved preview is segment 0, already paid for as a preview.
  const segments = job.segments.map((s) => (s.index === attempt.segmentIndex
    ? { ...s, status: 'done', resultPath: attempt.outputPath, error: null, credits: 0, fromAttemptId: attempt.id }
    : s));
  await updateJob(db, jobId, {
    attempts,
    segments,
    approvedAttemptId: attempt.id,
    characterImagePaths: [attempt.characterImagePath],
    productImagePaths: attempt.productImagePath ? [attempt.productImagePath] : [],
    generatePrompt: attempt.prompt,
    error: null,
  });
  return requireJob(db, jobId);
}

/** One more preview beyond the limit, after the user has seen the cost. Only once the limit is used up. */
export async function unlockPreview(db, jobId) {
  const job = await requireJob(db, jobId);
  if (!job.previewRequired) throw new Error('this job does not use previews');
  if (job.approvedAttemptId) throw new Error('a preview is already approved');
  if (usedPreviews(job) < job.previewLimit) throw new Error(`preview limit not reached yet (${job.previewLimit})`);
  await updateJob(db, jobId, { previewLimit: job.previewLimit + 1 });
  return requireJob(db, jobId);
}
