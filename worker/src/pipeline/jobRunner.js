import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadVideo as defaultDownloadVideo } from './download.js';
import { splitIntoSegments as defaultSplitIntoSegments } from './segment.js';
import { generateFromSegment as defaultGenerateFromSegment } from './generate.js';
import { mergeSegments as defaultMergeSegments } from './merge.js';
import { editVideo as defaultEditVideo } from './edit.js';
import {
  synthesizeSpeech as defaultSynthesizeSpeech,
  muxVoiceover as defaultMuxVoiceover,
} from './voiceover.js';
import { getJob, updateJob } from './db.js';
import { STAGE_ORDER } from './stages.js';
import { voiceFor } from './voices.js';
import { PREVIEW_SECONDS, estimateCredits, segmentSeconds, PRICED_STAGES, stageCredits } from './costs.js';

// Every stage records its own status and output on the job, so a run can stop
// anywhere and pick up from the first stage that is not `done` — nothing that
// already cost credits is generated twice.
export { STAGE_ORDER, initialStages } from './stages.js';

export function resolveDeps(deps = {}) {
  return {
    downloadVideo: deps.downloadVideo ?? defaultDownloadVideo,
    splitIntoSegments: deps.splitIntoSegments ?? defaultSplitIntoSegments,
    generateFromSegment: deps.generateFromSegment ?? defaultGenerateFromSegment,
    mergeSegments: deps.mergeSegments ?? defaultMergeSegments,
    editVideo: deps.editVideo ?? defaultEditVideo,
    synthesizeSpeech: deps.synthesizeSpeech ?? defaultSynthesizeSpeech,
    muxVoiceover: deps.muxVoiceover ?? defaultMuxVoiceover,
  };
}

async function requireJob(db, jobId) {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

async function setStage(db, jobId, stage, patch) {
  const job = await requireJob(db, jobId);
  const stages = { ...job.stages, [stage]: { ...job.stages[stage], ...patch } };
  return updateJob(db, jobId, { stages });
}

async function setSegmentStatus(db, jobId, index, status, resultPath, error, credits = null) {
  const job = await requireJob(db, jobId);
  const segment = job.segments.find((s) => s.index === index);
  segment.status = status;
  segment.resultPath = resultPath;
  segment.error = error ?? null;
  segment.credits = credits;
  await updateJob(db, jobId, { segments: job.segments });
}

/** The most recent finished video: the input for the next stage, and the result when nothing is left. */
export function latestVideoPath(job) {
  for (const stage of ['voiceover', 'edit', 'restyle', 'merge']) {
    const s = job.stages[stage];
    if (s?.status === 'done' && s.outputPath) return s.outputPath;
  }
  return null;
}

export function nextStage(job) {
  return STAGE_ORDER.find((stage) => !['done', 'skipped'].includes(job.stages[stage]?.status)) ?? null;
}

function previousStageDone(job, stage) {
  const before = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
  return before.every((s) => ['done', 'skipped'].includes(job.stages[s]?.status));
}

export const APPROVAL_REQUIRED = 'approve a preview before generating the remaining segments';

const generateCredits = (segment) => estimateCredits('ad_multiplier', { seconds: segmentSeconds(segment) });

/** Download and split only once; a resumed job keeps its segments. Shared by generate and preview. */
// An uploaded source is copied into the job folder, so the job keeps working
// even if the upload is cleaned up later; no download, no yt-dlp.
async function copyUploadedSource(uploadPath, workDir) {
  const ext = (path.extname(uploadPath) || '.mp4').toLowerCase();
  const sourcePath = path.join(workDir, `source${ext}`);
  await fs.mkdir(workDir, { recursive: true });
  await fs.copyFile(uploadPath, sourcePath);
  return sourcePath;
}

export async function ensureSegments(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  if (job.segments.length > 0) return job;
  const sourcePath = job.sourceVideoPath
    ? await copyUploadedSource(job.sourceVideoPath, workDir)
    : (await d.downloadVideo(job.youtubeUrl, workDir)).filePath;
  const options = job.previewRequired ? { firstSegmentSeconds: PREVIEW_SECONDS } : {};
  const segments = await d.splitIntoSegments(sourcePath, workDir, 10, options);
  await updateJob(db, jobId, {
    segments: segments.map((s) => ({ ...s, status: 'pending', resultPath: null, error: null, credits: null })),
  });
  return requireJob(db, jobId);
}

// --- stage bodies -----------------------------------------------------------

async function stageGenerate(db, jobId, workDir, d) {
  const job = await ensureSegments(db, jobId, workDir, d);

  let failed = 0;
  for (const segment of job.segments) {
    if (segment.status === 'done') continue;
    const outputPath = path.join(workDir, `generated-${segment.index}.mp4`);
    try {
      await d.generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
        productImagePath: job.productImagePaths?.[0],
        prompt: job.generatePrompt,
      });
      await setSegmentStatus(db, jobId, segment.index, 'done', outputPath, null, generateCredits(segment));
    } catch (error) {
      failed += 1;
      // Failed generations are refunded by Higgsfield, so they cost nothing.
      await setSegmentStatus(db, jobId, segment.index, 'failed', null, error.message, 0);
      // Keep going: each segment is billed on its own, and only the failed
      // ones need to run again next time.
    }
  }
  if (failed > 0) throw new Error(`${failed} segment(s) failed to generate`);
  return null;
}

async function stageMerge(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  const paths = [...job.segments].sort((a, b) => a.index - b.index).map((s) => s.resultPath);
  const outputPath = path.join(workDir, 'final.mp4');
  await d.mergeSegments(paths, outputPath);
  return outputPath;
}

async function stageRestyle(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  const outputPath = path.join(workDir, 'final-restyled.mp4');
  await d.editVideo(latestVideoPath(job), job.restylePrompt, outputPath);
  return outputPath;
}

async function stageEdit(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  const outputPath = path.join(workDir, 'final-edited.mp4');
  await d.editVideo(latestVideoPath(job), job.editPrompt, outputPath);
  return outputPath;
}

async function stageVoiceover(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  const audioPath = path.join(workDir, 'voiceover.mp3');
  await d.synthesizeSpeech(job.script, audioPath, { voice: voiceFor(job.voiceKey) });
  const outputPath = path.join(workDir, 'final-voiced.mp4');
  await d.muxVoiceover(latestVideoPath(job), audioPath, outputPath);
  return outputPath;
}

const bodies = {
  generate: stageGenerate,
  merge: stageMerge,
  restyle: stageRestyle,
  edit: stageEdit,
  voiceover: stageVoiceover,
};

// --- public API -------------------------------------------------------------

/** Run exactly one stage. Requires everything before it to be done or skipped. */
export async function runStage(db, jobId, workDir, stage, deps = {}) {
  if (!STAGE_ORDER.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  const d = resolveDeps(deps);
  const job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('Job is already running');
  if (job.stages[stage].status === 'skipped') throw new Error(`Stage ${stage} has no input and is skipped`);
  if (!previousStageDone(job, stage)) throw new Error(`Stage ${stage} needs the earlier stages to finish first`);
  if (stage === 'generate' && job.previewRequired && !job.approvedAttemptId) {
    throw new Error(APPROVAL_REQUIRED);
  }

  await updateJob(db, jobId, { status: 'running', currentStage: stage, error: null });
  await setStage(db, jobId, stage, { status: 'running', error: null });
  try {
    const outputPath = await bodies[stage](db, jobId, workDir, d);
    const patch = { status: 'done', outputPath, error: null };
    if (PRICED_STAGES.includes(stage)) patch.credits = stageCredits(await requireJob(db, jobId), stage);
    await setStage(db, jobId, stage, patch);
    const updated = await requireJob(db, jobId);
    const remaining = nextStage(updated);
    await updateJob(db, jobId, {
      status: remaining ? 'idle' : 'done',
      currentStage: null,
      resultPath: remaining ? null : latestVideoPath(updated),
    });
    return { stage, outputPath };
  } catch (error) {
    await setStage(db, jobId, stage, { status: 'failed', error: error.message });
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }
}

/** Run every remaining stage in order; stops at the first failure. Safe to call again to resume. */
export async function runJob(db, jobId, workDir, deps = {}) {
  let job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('Job is already running');
  let stage = nextStage(job);
  while (stage) {
    await runStage(db, jobId, workDir, stage, deps);
    job = await requireJob(db, jobId);
    stage = nextStage(job);
  }
  return { resultPath: job.resultPath };
}

const INPUT_STAGE = { restylePrompt: 'restyle', editPrompt: 'edit', script: 'voiceover' };

/**
 * Add, change or clear the optional prompts/script after the job exists (e.g.
 * after a preview is approved). A stage's input can change only while that
 * stage, and every stage after it, has not run yet.
 */
export async function updateJobInputs(db, jobId, inputs) {
  const job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('job is already running');

  const patch = {};
  const stages = { ...job.stages };
  for (const [field, stage] of Object.entries(INPUT_STAGE)) {
    if (!(field in inputs)) continue;
    const value = typeof inputs[field] === 'string' && inputs[field].trim() ? inputs[field].trim() : null;
    if (value === (job[field] ?? null)) continue;
    if (['done', 'running'].includes(stages[stage].status)) throw new Error(`stage ${stage} already ran`);
    const later = STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1).find((s) => stages[s]?.status === 'done');
    if (later) throw new Error(`stage ${stage} can no longer change: ${later} already ran`);
    patch[field] = value;
    stages[stage] = { status: value ? 'pending' : 'skipped', outputPath: null, error: null };
  }
  // The voice is not a stage input of its own: it belongs to the voice-over
  // and can change until that stage has run.
  if ('voiceKey' in inputs && inputs.voiceKey !== job.voiceKey) {
    voiceFor(inputs.voiceKey);
    if (['done', 'running'].includes(stages.voiceover.status)) throw new Error('stage voiceover already ran');
    patch.voiceKey = inputs.voiceKey;
  }
  if (Object.keys(patch).length === 0) return job;

  const reopened = job.status === 'done' && Object.values(stages).some((st) => st.status === 'pending');
  await updateJob(db, jobId, {
    ...patch,
    stages,
    ...(reopened ? { status: 'idle', resultPath: null } : {}),
  });
  return requireJob(db, jobId);
}

/** Regenerate one segment. Does not continue on its own — run the generate stage or the job afterwards. */
export async function retrySegment(db, jobId, segmentIndex, workDir, deps = {}) {
  const d = resolveDeps(deps);
  const job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('Job is already running');
  const segment = job.segments.find((s) => s.index === segmentIndex);
  if (!segment) throw new Error(`Segment not found: ${segmentIndex}`);

  const outputPath = path.join(workDir, `generated-${segmentIndex}.mp4`);
  await updateJob(db, jobId, { status: 'running', currentStage: 'generate', error: null });
  try {
    await d.generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
      productImagePath: job.productImagePaths?.[0],
      prompt: job.generatePrompt,
    });
    await setSegmentStatus(db, jobId, segmentIndex, 'done', outputPath, null, generateCredits(segment));
  } catch (error) {
    await setSegmentStatus(db, jobId, segmentIndex, 'failed', null, error.message, 0);
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }

  const updated = await requireJob(db, jobId);
  const allDone = updated.segments.every((s) => s.status === 'done');
  await setStage(db, jobId, 'generate', allDone ? { status: 'done', error: null } : { status: 'failed' });
  await updateJob(db, jobId, { status: 'idle', currentStage: null });
  return { outputPath };
}
