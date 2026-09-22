import { execFile as defaultExecFile } from './exec.js';
import { GENERATE_TIMEOUT_MS, recoverTimedOutJob } from './generate.js';

// FLUX 3 Video Edit: 15 credits per 10s (vs 70 for ad_multiplier's video_edit),
// free-form prompt, ~1 minute on the 2026-09-23 test. Kling 3.0 Omni Edit was
// tried first at the same price and failed the same input with no reason given.
export async function editVideo(
  videoPath,
  prompt,
  outputPath,
  { execFile = defaultExecFile } = {},
) {
  const startedAt = new Date();
  let job;
  try {
    const { stdout } = await execFile(
      'higgsfield',
      [
        'generate', 'create', 'flux_3_video_edit',
        '--prompt', prompt,
        '--video-references', videoPath,
        '--wait', '--json',
      ],
      { timeout: GENERATE_TIMEOUT_MS },
    );
    [job] = JSON.parse(stdout);
  } catch (error) {
    job = await recoverTimedOutJob(startedAt, execFile);
    if (!job) throw error;
  }

  if (!job.result_url) {
    throw new Error(`Higgsfield edit job ${job.id} finished without a result_url (status: ${job.status})`);
  }
  await execFile('curl', ['-fsSL', '-o', outputPath, job.result_url]);
  return { outputPath };
}
