import path from 'node:path';
import { execFile as defaultExecFile } from './exec.js';

export async function getDuration(filePath, { execFile = defaultExecFile } = {}) {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

export async function splitIntoSegments(
  filePath,
  outputDir,
  segmentSeconds = 10,
  { execFile = defaultExecFile, duration, firstSegmentSeconds } = {},
) {
  const totalDuration = duration ?? (await getDuration(filePath, { execFile }));

  // Compute chunk boundaries first (before touching ffmpeg) so we can fold a
  // too-short trailing remainder into the previous chunk before generating any
  // files. The epsilon guard avoids spawning a phantom near-zero final chunk
  // when floating-point drift puts totalDuration a hair past a clean multiple
  // of segmentSeconds (e.g. 30.000001 with segmentSeconds=10).
  // The preview flow cuts a shorter first segment (firstSegmentSeconds) so a
  // cheap preview of it can be generated and, once approved, reused as-is.
  const chunks = [];
  let start = 0;
  while (start < totalDuration - 1e-6) {
    const size = chunks.length === 0 && firstSegmentSeconds ? firstSegmentSeconds : segmentSeconds;
    const length = Math.min(size, totalDuration - start);
    chunks.push({ start, length });
    start += length;
  }

  // Higgsfield's engine has a 4-second minimum clip length. A trailing remainder
  // shorter than that can't be generated on its own (and would fail only after
  // every prior segment was already generated/billed), so fold it into the
  // second-to-last chunk instead of emitting it as its own segment. The merged
  // chunk can be up to segmentSeconds + 3 seconds long, which for the default
  // segmentSeconds=10 stays comfortably under the 30-second engine ceiling; a
  // caller passing a much larger segmentSeconds should confirm that ceiling still
  // holds for their value.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    if (last.length > 0 && last.length < 4) {
      const prev = chunks[chunks.length - 2];
      prev.length += last.length;
      chunks.pop();
    }
  }

  const segments = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const { start, length } = chunks[index];
    const outPath = path.join(outputDir, `segment-${String(index).padStart(3, '0')}.mp4`);

    await execFile('ffmpeg', [
      '-y',
      '-ss', String(start),
      '-i', filePath,
      '-t', String(length),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      outPath,
    ]);

    segments.push({ index, path: outPath, startSeconds: start, endSeconds: start + length });
  }

  return segments;
}
