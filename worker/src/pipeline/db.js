import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { initialStages } from './stages.js';
import { PREVIEW_LIMIT } from './costs.js';
import { DEFAULT_VOICE_KEY } from './voices.js';

export function createDb(dbPath) {
  const adapter = new JSONFile(dbPath);
  return new Low(adapter, { jobs: [] });
}

// lowdb's read() replaces db.data wholesale, so two concurrent read-mutate-write
// cycles (e.g. two jobs running at once, or a retry racing another job's update)
// can interleave and silently drop one writer's change. Chaining every mutation
// through this single promise queue guarantees each read+mutate+write completes
// before the next one starts.
let writeQueue = Promise.resolve();

function serialize(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.then(() => {}, () => {}); // don't let a rejection break the chain for future calls
  return result;
}

export async function createJob(
  db,
  {
    id,
    youtubeUrl,
    characterImagePaths,
    productImagePaths = [],
    script = null,
    restylePrompt = null,
    editPrompt = null,
    previewRequired = false,
    mock = false,
    ownerId = null,
    sourceVideoPath = null,
    sourceVideoName = null,
    voiceKey = DEFAULT_VOICE_KEY,
  },
) {
  return serialize(async () => {
    await db.read();
    db.data ||= { jobs: [] };

    const job = {
      id,
      youtubeUrl,
      sourceVideoPath,
      sourceVideoName,
      characterImagePaths,
      productImagePaths,
      script,
      restylePrompt,
      editPrompt,
      voiceKey,
      status: 'idle',
      currentStage: null,
      stages: initialStages({ restylePrompt, editPrompt, script }),
      previewRequired,
      mock,
      ownerId,
      previewLimit: PREVIEW_LIMIT,
      attempts: [],
      approvedAttemptId: null,
      generatePrompt: null,
      segments: [],
      resultPath: null,
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };

    db.data.jobs.push(job);
    await db.write();
    return job;
  });
}

// Jobs written before the preview flow carry no preview fields; they behave
// exactly as before (no preview required).
function withPreviewDefaults(job) {
  return {
    previewRequired: false, mock: false, ownerId: null, finishedAt: null, sourceVideoPath: null, sourceVideoName: null, voiceKey: DEFAULT_VOICE_KEY,
    previewLimit: PREVIEW_LIMIT, attempts: [], approvedAttemptId: null, generatePrompt: null, ...job,
  };
}

// Jobs written before the per-stage model carry a flat status and no `stages`.
// Give them a stage record derived from what is known (their segments) so the
// runner and the canvas can treat every job the same way.
function normalizeJob(job) {
  if (job.stages) return withPreviewDefaults(job);
  const stages = initialStages(job);
  const allDone = job.segments.length > 0 && job.segments.every((s) => s.status === 'done');
  if (allDone) stages.generate.status = 'done';
  else if (job.segments.some((s) => s.status === 'failed')) stages.generate.status = 'failed';
  const legacyDone = job.status === 'done' && job.resultPath;
  if (legacyDone) {
    for (const s of Object.values(stages)) if (s.status !== 'skipped') s.status = 'done';
  }
  return withPreviewDefaults({
    ...job,
    stages,
    currentStage: null,
    status: legacyDone ? 'done' : job.status === 'failed' || job.error ? 'failed' : 'idle',
    error: job.error ?? null,
  });
}

export async function getJob(db, id) {
  await db.read();
  const job = db.data.jobs.find((j) => j.id === id);
  return job ? normalizeJob(job) : null;
}

export async function listJobs(db) {
  await db.read();
  return db.data.jobs.map(normalizeJob);
}

// When a job stops (done/failed) record the time; starting it again clears it.
function finishedPatch(patch) {
  if (!('status' in patch)) return {};
  if (patch.status === 'done' || patch.status === 'failed') return { finishedAt: new Date().toISOString() };
  if (patch.status === 'running') return { finishedAt: null };
  return {};
}

export async function updateJob(db, id, patch) {
  return serialize(async () => {
    await db.read();
    const job = db.data.jobs.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }
    Object.assign(job, patch, finishedPatch(patch));
    await db.write();
    return job;
  });
}
