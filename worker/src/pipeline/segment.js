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
  { execFile = defaultExecFile, duration } = {},
) {
  const totalDuration = duration ?? (await getDuration(filePath, { execFile }));
  const segments = [];
  let index = 0;

  for (let start = 0; start < totalDuration; start += segmentSeconds) {
    const length = Math.min(segmentSeconds, totalDuration - start);
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
    index += 1;
  }

  return segments;
}
