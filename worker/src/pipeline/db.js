import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

export function createDb(dbPath) {
  const adapter = new JSONFile(dbPath);
  return new Low(adapter, { jobs: [] });
}

export async function createJob(db, { id, youtubeUrl, characterImagePaths }) {
  await db.read();
  db.data ||= { jobs: [] };

  const job = {
    id,
    youtubeUrl,
    characterImagePaths,
    status: 'pending',
    segments: [],
    resultPath: null,
    createdAt: new Date().toISOString(),
  };

  db.data.jobs.push(job);
  await db.write();
  return job;
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
  await db.read();
  const job = db.data.jobs.find((j) => j.id === id);
  if (!job) {
    throw new Error(`Job not found: ${id}`);
  }
  Object.assign(job, patch);
  await db.write();
  return job;
}
