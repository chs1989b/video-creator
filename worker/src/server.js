import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, createJob, getJob, listJobs } from './pipeline/db.js';
import {
  runJob as defaultRunJob,
  runStage as defaultRunStage,
  retrySegment as defaultRetrySegment,
  nextStage,
  APPROVAL_REQUIRED,
} from './pipeline/jobRunner.js';
import {
  runPreview as defaultRunPreview,
  recordVerdict as defaultRecordVerdict,
  unlockPreview as defaultUnlockPreview,
  previewBlocker,
} from './pipeline/preview.js';
import { jobTotals, estimateRemaining } from './pipeline/costs.js';
import { STAGE_ORDER } from './pipeline/stages.js';

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function createApp({
  dataDir,
  runJob = defaultRunJob,
  runStage = defaultRunStage,
  retrySegment = defaultRetrySegment,
  runPreview = defaultRunPreview,
  recordVerdict = defaultRecordVerdict,
  unlockPreview = defaultUnlockPreview,
}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const withTotals = (job) => ({ ...job, totals: jobTotals(job) });
  const needsApproval = (job) => job.previewRequired && !job.approvedAttemptId;

  const db = createDb(path.join(dataDir, 'db.json'));
  const uploadsDir = path.join(dataDir, 'uploads');
  // multer.diskStorage's destination callback does NOT auto-create the directory
  // the way the bare `dest:` shorthand used to — create it explicitly up front.
  mkdirSync(uploadsDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    // multer's default filename has no extension, which breaks CLIs (like the
    // Higgsfield CLI) that detect media type from the file extension.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  });
  const upload = multer({ storage });

  const jobUploads = upload.fields([
    { name: 'characterImages', maxCount: 1 },
    { name: 'productImages', maxCount: 1 },
  ]);

  const workDirFor = (id) => path.join(dataDir, 'jobs', id);

  // Stage runs are long (minutes); respond at once and let the client poll.
  function startInBackground(label, promise) {
    promise.catch((error) => {
      console.error(`${label} failed:`, error.message);
    });
  }

  app.post('/jobs', jobUploads, async (req, res) => {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) {
      res.status(400).json({ error: 'youtubeUrl is required' });
      return;
    }
    const characterFiles = req.files?.characterImages ?? [];
    if (characterFiles.length !== 1) {
      res.status(400).json({ error: 'exactly one characterImages file is required' });
      return;
    }

    const id = randomUUID();
    const characterImagePaths = characterFiles.map((file) => file.path);
    const productImagePaths = (req.files?.productImages ?? []).map((file) => file.path);
    const script = optionalText(req.body.script);
    const restylePrompt = optionalText(req.body.restylePrompt);
    const editPrompt = optionalText(req.body.editPrompt);
    const previewRequired = req.body.preview === 'true';
    const job = await createJob(db, {
      id, youtubeUrl, characterImagePaths, productImagePaths, script, restylePrompt, editPrompt, previewRequired,
    });

    await fs.mkdir(workDirFor(id), { recursive: true });

    // autorun=false creates the job and waits for stage-by-stage requests.
    if (req.body.autorun !== 'false' && !previewRequired) {
      startInBackground(`Job ${id}`, runJob(db, id, workDirFor(id)));
    }

    res.status(201).json(withTotals(job));
  });

  app.get('/jobs', async (_req, res) => {
    res.json((await listJobs(db)).map(withTotals));
  });

  app.get('/jobs/:id', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(withTotals(job));
  });

  // Resume: runs every stage that is not done yet, in order.
  app.post('/jobs/:id/run', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (job.status === 'running') {
      res.status(409).json({ error: 'job is already running' });
      return;
    }
    if (needsApproval(job) && nextStage(job) === 'generate') {
      res.status(409).json({ error: APPROVAL_REQUIRED });
      return;
    }
    startInBackground(`Job ${job.id}`, runJob(db, job.id, workDirFor(job.id)));
    res.status(202).json({ ok: true });
  });

  // Step: runs a single stage; earlier stages must already be done.
  app.post('/jobs/:id/stages/:stage/run', async (req, res) => {
    const { id, stage } = req.params;
    const job = await getJob(db, id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!STAGE_ORDER.includes(stage)) {
      res.status(400).json({ error: `unknown stage: ${stage}` });
      return;
    }
    if (job.status === 'running') {
      res.status(409).json({ error: 'job is already running' });
      return;
    }
    if (stage === 'generate' && needsApproval(job)) {
      res.status(409).json({ error: APPROVAL_REQUIRED });
      return;
    }
    const earlier = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
    if (!earlier.every((s) => ['done', 'skipped'].includes(job.stages[s]?.status))) {
      res.status(409).json({ error: `stage ${stage} needs the earlier stages to finish first` });
      return;
    }
    if (job.stages[stage]?.status === 'skipped') {
      res.status(409).json({ error: `stage ${stage} has no input and is skipped` });
      return;
    }
    startInBackground(`Job ${id} stage ${stage}`, runStage(db, id, workDirFor(id), stage));
    res.status(202).json({ ok: true, stage });
  });

  const previewUploads = upload.fields([
    { name: 'characterImages', maxCount: 1 },
    { name: 'productImages', maxCount: 1 },
  ]);

  // Preview: generate only the first (5-second) segment. Runs in the background.
  app.post('/jobs/:id/previews', previewUploads, async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const blocker = previewBlocker(job);
    if (blocker) {
      res.status(409).json({ error: blocker });
      return;
    }
    const options = {
      prompt: optionalText(req.body.prompt),
      characterImagePath: req.files?.characterImages?.[0]?.path ?? null,
      productImagePath: req.files?.productImages?.[0]?.path ?? null,
    };
    startInBackground(`Job ${job.id} preview`, runPreview(db, job.id, workDirFor(job.id), options));
    res.status(202).json({ ok: true });
  });

  app.post('/jobs/:id/previews/unlock', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    try {
      res.json(withTotals(await unlockPreview(db, job.id)));
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });

  app.post('/jobs/:id/attempts/:attemptId/verdict', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    try {
      const updated = await recordVerdict(db, job.id, req.params.attemptId, {
        verdict: req.body?.verdict,
        reasons: Array.isArray(req.body?.reasons) ? req.body.reasons : [],
      });
      res.json(withTotals(updated));
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });

  app.get('/jobs/:id/attempts/:attemptId/output', async (req, res) => {
    const job = await getJob(db, req.params.id);
    const attempt = job?.attempts.find((a) => a.id === req.params.attemptId);
    if (!attempt?.outputPath) {
      res.status(404).json({ error: 'preview not ready' });
      return;
    }
    res.sendFile(attempt.outputPath);
  });

  app.get('/jobs/:id/estimate', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(estimateRemaining(job));
  });

  app.post('/jobs/:id/segments/:index/retry', async (req, res) => {
    try {
      const result = await retrySegment(db, req.params.id, Number(req.params.index), workDirFor(req.params.id));
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

  // Any finished stage's video, so the canvas can preview intermediate output.
  app.get('/jobs/:id/stages/:stage/output', async (req, res) => {
    const job = await getJob(db, req.params.id);
    const output = job?.stages?.[req.params.stage]?.outputPath;
    if (!output) {
      res.status(404).json({ error: 'stage output not ready' });
      return;
    }
    res.sendFile(output);
  });

  return app;
}
