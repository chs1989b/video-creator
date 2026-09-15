import { execFile as defaultExecFile } from './exec.js';
import { getDuration as defaultGetDuration } from './segment.js';

export async function mergeSegments(
  segmentPaths,
  outputPath,
  { execFile = defaultExecFile, crossfadeSeconds = 0.5, getDuration = defaultGetDuration } = {},
) {
  if (segmentPaths.length === 0) {
    throw new Error('mergeSegments requires at least one segment');
  }

  if (segmentPaths.length === 1) {
    await execFile('ffmpeg', ['-y', '-i', segmentPaths[0], '-c', 'copy', outputPath]);
    return { outputPath };
  }

  const durations = [];
  for (const segmentPath of segmentPaths) {
    durations.push(await getDuration(segmentPath, { execFile }));
  }

  const inputArgs = segmentPaths.flatMap((p) => ['-i', p]);

  let videoLabel = '[0:v]';
  let audioLabel = '[0:a]';
  let cumulativeOffset = durations[0];
  const filters = [];

  for (let i = 1; i < segmentPaths.length; i += 1) {
    const offset = cumulativeOffset - crossfadeSeconds;
    const nextVideoLabel = `[v${i}]`;
    const nextAudioLabel = `[a${i}]`;

    filters.push(
      `${videoLabel}[${i}:v]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${offset}${nextVideoLabel}`,
    );
    filters.push(`${audioLabel}[${i}:a]acrossfade=d=${crossfadeSeconds}${nextAudioLabel}`);

    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
    cumulativeOffset += durations[i] - crossfadeSeconds;
  }

  const filterComplex = filters.join(';');

  await execFile('ffmpeg', [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', videoLabel,
    '-map', audioLabel,
    outputPath,
  ]);

  return { outputPath };
}
