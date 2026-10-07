import fs from 'node:fs/promises';
import { execFile as defaultExecFile } from './exec.js';

// Stand-ins for the three calls that spend Higgsfield credits, used when the
// worker runs with GENERATOR=mock. Everything around them (download, split,
// merge, mux) still runs for real, so the whole flow can be exercised for free.
// The output is the source footage, not a swapped face: it proves the flow,
// not the quality.

/** Face (and product) swap stand-in: the segment itself, muted like the real call. */
export async function mockGenerateFromSegment(
  segmentPath,
  _characterImagePath,
  outputPath,
  { execFile = defaultExecFile } = {},
) {
  await execFile('ffmpeg', ['-y', '-i', segmentPath, '-an', '-c:v', 'copy', outputPath]);
  return { outputPath };
}

/** FLUX edit stand-in: the input video unchanged. */
export async function mockEditVideo(videoPath, _prompt, outputPath) {
  await fs.copyFile(videoPath, outputPath);
  return { outputPath };
}

const WORDS_PER_SECOND = 2.5;

/** TTS stand-in: silence about as long as reading the script aloud. */
export async function mockSynthesizeSpeech(script, outputPath, { execFile = defaultExecFile } = {}) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const seconds = Math.max(2, Math.ceil(words / WORDS_PER_SECOND));
  await execFile('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), outputPath]);
  return { outputPath };
}

export const MOCK_DEPS = {
  generateFromSegment: mockGenerateFromSegment,
  editVideo: mockEditVideo,
  synthesizeSpeech: mockSynthesizeSpeech,
};
