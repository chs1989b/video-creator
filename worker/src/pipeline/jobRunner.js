import path from 'node:path';
import { downloadVideo as defaultDownloadVideo } from './download.js';
import { splitIntoSegments as defaultSplitIntoSegments } from './segment.js';
import { generateFromSegment as defaultGenerateFromSegment } from './generate.js';
import { mergeSegments as defaultMergeSegments } from './merge.js';
import { getJob, updateJob } from './db.js';

async function setSegmentStatus(db, jobId, index, status, resultPath, error) {
  const job = await getJob(db, jobId);
  const segment = job.segments.find((s) => s.index === index);
  segment.status = status;
  segment.resultPath = resultPath;
  if (error) {
    segment.error = error;
  }
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
    for (const segment of segments) {
      const outputPath = path.join(workDir, `generated-${segment.index}.mp4`);
      try {
        await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath);
        resultPaths.push(outputPath);
        await setSegmentStatus(db, jobId, segment.index, 'done', outputPath);
      } catch (error) {
        await setSegmentStatus(db, jobId, segment.index, 'failed', null, error.message);
        throw error;
      }
    }

    await updateJob(db, jobId, { status: 'merging' });
    const finalPath = path.join(workDir, 'final.mp4');
    await mergeSegments(resultPaths, finalPath);

    await updateJob(db, jobId, { status: 'done', resultPath: finalPath });
    return { resultPath: finalPath };
  } catch (error) {
    // Persist failure regardless of which stage threw (download/segment/generate/merge),
    // so GET /jobs/:id never shows a job stuck forever in an in-progress status.
    await updateJob(db, jobId, { status: 'failed', error: error.message });
    throw error;
  }
}

export async function retrySegment(db, jobId, segmentIndex, workDir, deps = {}) {
  const generateFromSegment = deps.generateFromSegment ?? defaultGenerateFromSegment;

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
    await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath);
    await setSegmentStatus(db, jobId, segmentIndex, 'done', outputPath);
  } catch (error) {
    await setSegmentStatus(db, jobId, segmentIndex, 'failed', null, error.message);
    throw error;
  }

  return { outputPath };
}
