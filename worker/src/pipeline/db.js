import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

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
  { id, youtubeUrl, characterImagePaths, productImagePaths = [], script = null, editPrompt = null },
) {
  return serialize(async () => {
    await db.read();
    db.data ||= { jobs: [] };

    const job = {
      id,
      youtubeUrl,
      characterImagePaths,
      productImagePaths,
      script,
      editPrompt,
      status: 'pending',
      segments: [],
      resultPath: null,
      createdAt: new Date().toISOString(),
    };

    db.data.jobs.push(job);
    await db.write();
    return job;
  });
}

export async function getJob(db, id) {
  await db.read();
  return db.data.jobs.find((job) => job.id === id) ?? null;
}

export async function listJobs(db) {
  await db.read();
  return db.data.jobs;
}

export async function updateJob(db, id, patch) {
  return serialize(async () => {
    await db.read();
    const job = db.data.jobs.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }
    Object.assign(job, patch);
    await db.write();
    return job;
  });
}
