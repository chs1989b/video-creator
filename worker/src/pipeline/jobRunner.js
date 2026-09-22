import path from 'node:path';
import { downloadVideo as defaultDownloadVideo } from './download.js';
import { splitIntoSegments as defaultSplitIntoSegments } from './segment.js';
import { generateFromSegment as defaultGenerateFromSegment } from './generate.js';
import { mergeSegments as defaultMergeSegments } from './merge.js';
import {
  synthesizeSpeech as defaultSynthesizeSpeech,
  muxVoiceover as defaultMuxVoiceover,
} from './voiceover.js';
import { getJob, updateJob } from './db.js';

async function setSegmentStatus(db, jobId, index, status, resultPath, error) {
  const job = await getJob(db, jobId);
  const segment = job.segments.find((s) => s.index === index);
  segment.status = status;
  segment.resultPath = resultPath;
  segment.error = error ?? null;
  await updateJob(db, jobId, { segments: job.segments });
}

export async function runJob(db, jobId, workDir, deps = {}) {
  const downloadVideo = deps.downloadVideo ?? defaultDownloadVideo;
  const splitIntoSegments = deps.splitIntoSegments ?? defaultSplitIntoSegments;
  const generateFromSegment = deps.generateFromSegment ?? defaultGenerateFromSegment;
  const mergeSegments = deps.mergeSegments ?? defaultMergeSegments;

  const job = await getJob(db, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  try {
    await updateJob(db, jobId, { status: 'downloading' });
    const { filePath: sourcePath } = await downloadVideo(job.youtubeUrl, workDir);

    await updateJob(db, jobId, { status: 'segmenting' });
    const segments = await splitIntoSegments(sourcePath, workDir, 10);
    await updateJob(db, jobId, {
      segments: segments.map((s) => ({ ...s, status: 'pending', resultPath: null })),
    });

    await updateJob(db, jobId, { status: 'generating' });
    const resultPaths = [];
    let failedCount = 0;
    for (const segment of segments) {
      const outputPath = path.join(workDir, `generated-${segment.index}.mp4`);
      try {
        await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
          productImagePath: job.productImagePaths?.[0],
        });
        resultPaths.push(outputPath);
        await setSegmentStatus(db, jobId, segment.index, 'done', outputPath);
      } catch (error) {
        failedCount += 1;
        await setSegmentStatus(db, jobId, segment.index, 'failed', null, error.message);
        // Keep attempting the remaining segments instead of aborting the whole
        // job on the first failure — each segment is generated (and billed)
        // independently, and a later retry of just the failed one(s) can still
        // complete the job without regenerating segments that already succeeded.
      }
    }

    if (failedCount > 0) {
      throw new Error(`${failedCount} segment(s) failed to generate`);
    }

    await updateJob(db, jobId, { status: 'merging' });
    const finalPath = path.join(workDir, 'final.mp4');
    await mergeSegments(resultPaths, finalPath);

    const resultPath = await applyVoiceover(db, jobId, workDir, finalPath, deps);
    await updateJob(db, jobId, { status: 'done', resultPath });
    return { resultPath };
  } catch (error) {
    // Persist failure regardless of which stage threw (download/segment/generate/merge),
    // so GET /jobs/:id never shows a job stuck forever in an in-progress status.
    await updateJob(db, jobId, { status: 'failed', error: error.message });
    throw error;
  }
}

export async function retrySegment(db, jobId, segmentIndex, workDir, deps = {}) {
  const generateFromSegment = deps.generateFromSegment ?? defaultGenerateFromSegment;
  const mergeSegments = deps.mergeSegments ?? defaultMergeSegments;

  const job = await getJob(db, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const segment = job.segments.find((s) => s.index === segmentIndex);
  if (!segment) {
    throw new Error(`Segment not found: ${segmentIndex}`);
  }

  const outputPath = path.join(workDir, `generated-${segmentIndex}.mp4`);
  try {
    await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
      productImagePath: job.productImagePaths?.[0],
    });
    await setSegmentStatus(db, jobId, segmentIndex, 'done', outputPath);
  } catch (error) {
    await setSegmentStatus(db, jobId, segmentIndex, 'failed', null, error.message);
    throw error;
  }

  // A retry that clears the last failed segment is the only path back to a
  // finished video after a partial failure (runJob no longer retries on its
  // own). Once every segment is done, merge immediately so resultPath gets
  // set and GET /jobs/:id/result stops 404ing; if segments are still
  // failed/pending, leave the job as-is until they're retried too.
  await maybeFinishJob(db, jobId, workDir, { ...deps, mergeSegments });

  return { outputPath };
}

async function maybeFinishJob(db, jobId, workDir, deps) {
  const job = await getJob(db, jobId);
  const allDone = job.segments.length > 0 && job.segments.every((s) => s.status === 'done');
  if (!allDone) {
    return;
  }

  const resultPaths = [...job.segments]
    .sort((a, b) => a.index - b.index)
    .map((s) => s.resultPath);

  const finalPath = path.join(workDir, 'final.mp4');
  await updateJob(db, jobId, { status: 'merging' });
  await deps.mergeSegments(resultPaths, finalPath);
  const resultPath = await applyVoiceover(db, jobId, workDir, finalPath, deps);
  await updateJob(db, jobId, { status: 'done', resultPath });
}

// Optional last stage: when the job carries a script, narrate it over the merged
// video. Without a script the merged file is the result, unchanged.
async function applyVoiceover(db, jobId, workDir, mergedPath, deps = {}) {
  const job = await getJob(db, jobId);
  if (!job.script) {
    return mergedPath;
  }
  const synthesizeSpeech = deps.synthesizeSpeech ?? defaultSynthesizeSpeech;
  const muxVoiceover = deps.muxVoiceover ?? defaultMuxVoiceover;

  await updateJob(db, jobId, { status: 'voiceover' });
  const audioPath = path.join(workDir, 'voiceover.mp3');
  await synthesizeSpeech(job.script, audioPath);
  const voicedPath = path.join(workDir, 'final-voiced.mp4');
  await muxVoiceover(mergedPath, audioPath, voicedPath);
  return voicedPath;
}
