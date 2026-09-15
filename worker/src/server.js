import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDb, createJob, getJob, listJobs } from './pipeline/db.js';
import { runJob as defaultRunJob, retrySegment as defaultRetrySegment } from './pipeline/jobRunner.js';

export function createApp({ dataDir, runJob = defaultRunJob, retrySegment = defaultRetrySegment }) {
  const app = express();
  app.use(cors());

  const db = createDb(path.join(dataDir, 'db.json'));
  const upload = multer({ dest: path.join(dataDir, 'uploads') });

  app.post('/jobs', upload.array('characterImages', 1), async (req, res) => {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) {
      res.status(400).json({ error: 'youtubeUrl is required' });
      return;
    }
    if (!req.files || req.files.length !== 1) {
      res.status(400).json({ error: 'exactly one characterImages file is required' });
      return;
    }

    const id = randomUUID();
    const characterImagePaths = (req.files ?? []).map((file) => file.path);
    const job = await createJob(db, { id, youtubeUrl, characterImagePaths });

    const workDir = path.join(dataDir, 'jobs', id);
    await fs.mkdir(workDir, { recursive: true });

    runJob(db, id, workDir).catch((error) => {
      console.error(`Job ${id} failed:`, error.message);
    });

    res.status(201).json(job);
  });

  app.get('/jobs', async (_req, res) => {
    res.json(await listJobs(db));
  });

  app.get('/jobs/:id', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(job);
  });

  app.post('/jobs/:id/segments/:index/retry', async (req, res) => {
    const workDir = path.join(dataDir, 'jobs', req.params.id);
    try {
      const result = await retrySegment(db, req.params.id, Number(req.params.index), workDir);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/jobs/:id/result', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job || !job.resultPath) {
      res.status(404).json({ error: 'result not ready' });
      return;
    }
    res.sendFile(job.resultPath);
  });

  return app;
}
