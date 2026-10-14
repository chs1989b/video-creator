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
  updateJobInputs,
} from './pipeline/jobRunner.js';
import {
  runPreview as defaultRunPreview,
  recordVerdict as defaultRecordVerdict,
  unlockPreview as defaultUnlockPreview,
  previewBlocker,
} from './pipeline/preview.js';
import { jobTotals, estimateRemaining, priceTable, RESOLUTIONS, DEFAULT_RESOLUTION } from './pipeline/costs.js';
import { jobStats } from './pipeline/stats.js';
import { VOICES, DEFAULT_VOICE_KEY, isVoiceKey } from './pipeline/voices.js';
import { MOCK_DEPS } from './pipeline/mockGenerators.js';
import { STAGE_ORDER } from './pipeline/stages.js';

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Original source video (instead of a URL): common phone/camera formats, up to 200MB.
const SOURCE_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// multer 1.x reads multipart file names as latin1; browsers send UTF-8, so a
// Korean name arrives garbled unless it is decoded again.
function originalName(file) {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

export function createApp({
  dataDir,
  runJob = defaultRunJob,
  runStage = defaultRunStage,
  retrySegment = defaultRetrySegment,
  runPreview = defaultRunPreview,
  recordVerdict = defaultRecordVerdict,
  unlockPreview = defaultUnlockPreview,
  generator = 'higgsfield',
}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const withTotals = (job) => ({ ...job, totals: jobTotals(job), estimate: estimateRemaining(job) });

  // GENERATOR=mock swaps the three paid Higgsfield calls for free stand-ins.
  // A job remembers which generator made it, and the other generator refuses
  // to run it: no fake segments inside a paid job, no credits on a test job.
  const mockMode = generator === 'mock';
  const deps = mockMode ? MOCK_DEPS : undefined;
  const generatorMismatch = (job) => {
    if (Boolean(job.mock) === mockMode) return null;
    return job.mock
      ? 'this is a test (mock) job; run it on a worker started with GENERATOR=mock'
      : 'this is a real job; the worker is in test (mock) mode and would write fake output into it';
  };
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
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(originalName(file)).toLowerCase()}`),
  });
  const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

  // multer errors (too large) answer as JSON instead of an HTML error page.
  const withUploadErrors = (handler) => (req, res, next) => handler(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? `파일은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다.` : error.message,
    });
  });

  const jobUploads = withUploadErrors(upload.fields([
    { name: 'sourceVideo', maxCount: 1 },
    { name: 'characterImages', maxCount: 1 },
    { name: 'productImages', maxCount: 1 },
  ]));

  const workDirFor = (id) => path.join(dataDir, 'jobs', id);

  // Stage runs are long (minutes); respond at once and let the client poll.
  function startInBackground(label, promise) {
    promise.catch((error) => {
      console.error(`${label} failed:`, error.message);
    });
  }

  // The web app's proxy forwards the signed-in user as x-owner-id. With it, a
  // request sees only that user's jobs; without it (direct local calls) the
  // worker behaves as before. The worker itself has no login: this separates
  // demo users on one machine, it does not make the worker safe to expose.
  const ownerOf = (req) => req.get('x-owner-id') || null;
  app.param('id', async (req, res, next, id) => {
    const owner = ownerOf(req);
    if (!owner) return next();
    const job = await getJob(db, id);
    if (job && job.ownerId !== owner) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    next();
  });

  // Narration voices, and which sample clips exist on this machine
  // (data/voice_samples/<key>-<ko|en>.mp3 — local files, not in git).
  const samplePath = (key, lang) => path.join(dataDir, 'voice_samples', `${key}-${lang}.mp3`);
  const exists = (p) => fs.access(p).then(() => true, () => false);
  app.get('/voices', async (_req, res) => {
    res.json(await Promise.all(VOICES.map(async ({ key, label, name, gender }) => ({
      key, label, name, gender,
      samples: { ko: await exists(samplePath(key, 'ko')), en: await exists(samplePath(key, 'en')) },
    }))));
  });
  app.get('/voices/:key/sample', async (req, res) => {
    const { key } = req.params;
    const lang = req.query.lang;
    if (!isVoiceKey(key) || !['ko', 'en'].includes(lang) || !(await exists(samplePath(key, lang)))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.type('audio/mpeg').sendFile(samplePath(key, lang));
  });

  // Tries and cost so far, for the signed-in user's jobs made by this generator.
  app.get('/stats', async (req, res) => {
    const owner = ownerOf(req);
    const jobs = (await listJobs(db)).filter((j) => Boolean(j.mock) === mockMode && (!owner || j.ownerId === owner));
    res.json({ mode: mockMode ? 'mock' : 'higgsfield', ...jobStats(jobs) });
  });

  app.get('/config', (_req, res) => {
    res.json({ generator: mockMode ? 'mock' : 'higgsfield', prices: priceTable() });
  });

  app.post('/jobs', jobUploads, async (req, res) => {
    const youtubeUrl = optionalText(req.body.youtubeUrl);
    const sourceFile = req.files?.sourceVideo?.[0] ?? null;
    const reject = async (error) => {
      // Nothing keeps a rejected request's uploads, so remove them now.
      const uploaded = Object.values(req.files ?? {}).flat();
      await Promise.all(uploaded.map((file) => fs.rm(file.path, { force: true })));
      res.status(400).json({ error });
    };
    if (!youtubeUrl && !sourceFile) return reject('원본 영상 링크나 파일이 필요합니다.');
    if (youtubeUrl && sourceFile) return reject('원본 영상은 링크와 파일 중 하나만 보내 주세요.');
    if (sourceFile && !SOURCE_EXTENSIONS.includes(path.extname(originalName(sourceFile)).toLowerCase())) {
      return reject(`원본 영상 파일은 ${SOURCE_EXTENSIONS.map((e) => e.slice(1)).join(', ')}만 받습니다.`);
    }
    const characterFiles = req.files?.characterImages ?? [];
    if (characterFiles.length !== 1) return reject('exactly one characterImages file is required');
    const resolution = optionalText(req.body.resolution) ?? DEFAULT_RESOLUTION;
    if (!RESOLUTIONS.includes(resolution)) return reject(`해상도는 ${RESOLUTIONS.join(', ')}만 고를 수 있습니다.`);
    const voiceKey = optionalText(req.body.voiceKey) ?? DEFAULT_VOICE_KEY;
    if (!isVoiceKey(voiceKey)) return reject(`모르는 목소리입니다: ${voiceKey}`);

    const id = randomUUID();
    const characterImagePaths = characterFiles.map((file) => file.path);
    const productImagePaths = (req.files?.productImages ?? []).map((file) => file.path);
    const script = optionalText(req.body.script);
    const restylePrompt = optionalText(req.body.restylePrompt);
    const editPrompt = optionalText(req.body.editPrompt);
    const previewRequired = req.body.preview === 'true';
    const job = await createJob(db, {
      id, youtubeUrl, characterImagePaths, productImagePaths, script, restylePrompt, editPrompt, previewRequired, mock: mockMode,
      ownerId: ownerOf(req),
      sourceVideoPath: sourceFile?.path ?? null,
      sourceVideoName: sourceFile ? originalName(sourceFile) : null,
      voiceKey,
      resolution,
    });

    await fs.mkdir(workDirFor(id), { recursive: true });

    // autorun=false creates the job and waits for stage-by-stage requests.
    if (req.body.autorun !== 'false' && !previewRequired) {
      startInBackground(`Job ${id}`, runJob(db, id, workDirFor(id), deps));
    }

    res.status(201).json(withTotals(job));
  });

  app.get('/jobs', async (req, res) => {
    const owner = ownerOf(req);
    const jobs = await listJobs(db);
    res.json((owner ? jobs.filter((j) => j.ownerId === owner) : jobs).map(withTotals));
  });

  app.get('/jobs/:id', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(withTotals(job));
  });

  // Add or change the optional prompts/script later (e.g. after a preview is approved).
  app.patch('/jobs/:id', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const inputs = {};
    for (const field of ['script', 'restylePrompt', 'editPrompt', 'voiceKey']) {
      if (req.body && field in req.body) inputs[field] = req.body[field];
    }
    try {
      res.json(withTotals(await updateJobInputs(db, job.id, inputs)));
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
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
    const mismatch = generatorMismatch(job);
    if (mismatch) {
      res.status(409).json({ error: mismatch });
      return;
    }
    if (needsApproval(job) && nextStage(job) === 'generate') {
      res.status(409).json({ error: APPROVAL_REQUIRED });
      return;
    }
    startInBackground(`Job ${job.id}`, runJob(db, job.id, workDirFor(job.id), deps));
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
    const stageMismatch = generatorMismatch(job);
    if (stageMismatch) {
      res.status(409).json({ error: stageMismatch });
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
    startInBackground(`Job ${id} stage ${stage}`, runStage(db, id, workDirFor(id), stage, deps));
    res.status(202).json({ ok: true, stage });
  });

  const previewUploads = upload.fields([
    { name: 'characterImages', maxCount: 1 },
    { name: 'productImages', maxCount: 1 },
  ]);

  // A preview costs credits, so two requests racing past the status check
  // (a double click) must not both start one. The mark is taken before the
  // first await and released when the preview ends.
  const previewInFlight = new Set();

  // Preview: generate only the first (5-second) segment. Runs in the background.
  app.post('/jobs/:id/previews', previewUploads, async (req, res) => {
    const { id } = req.params;
    if (previewInFlight.has(id)) {
      res.status(409).json({ error: 'a preview is already starting' });
      return;
    }
    previewInFlight.add(id);
    let started = false;
    try {
      const job = await getJob(db, id);
      if (!job) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const blocker = generatorMismatch(job) ?? previewBlocker(job);
      if (blocker) {
        res.status(409).json({ error: blocker });
        return;
      }
      const options = {
        prompt: optionalText(req.body.prompt),
        characterImagePath: req.files?.characterImages?.[0]?.path ?? null,
        productImagePath: req.files?.productImages?.[0]?.path ?? null,
      };
      const run = Promise.resolve(runPreview(db, job.id, workDirFor(job.id), options, deps))
        .finally(() => previewInFlight.delete(id));
      started = true;
      startInBackground(`Job ${job.id} preview`, run);
      res.status(202).json({ ok: true });
    } finally {
      if (!started) previewInFlight.delete(id);
    }
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
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const mismatch = generatorMismatch(job);
    if (mismatch) {
      res.status(409).json({ error: mismatch });
      return;
    }
    try {
      const result = await retrySegment(db, req.params.id, Number(req.params.index), workDirFor(req.params.id), deps);
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

  // The saved person / product photo, so a reloaded job shows what it was made with.
  // After approval these are the approved attempt's photos.
  app.get('/jobs/:id/images/:kind', async (req, res) => {
    const job = await getJob(db, req.params.id);
    const paths = { character: job?.characterImagePaths, product: job?.productImagePaths }[req.params.kind];
    if (!paths?.[0]) {
      res.status(404).json({ error: 'no such image' });
      return;
    }
    res.sendFile(paths[0]);
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
