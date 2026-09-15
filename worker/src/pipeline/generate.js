import { execFile as defaultExecFile } from './exec.js';

export async function generateFromSegment(
  segmentPath,
  characterImagePath,
  outputPath,
  { execFile = defaultExecFile } = {},
) {
  const { stdout } = await execFile('higgsfield', [
    'generate', 'workflow', 'kling3_0_motion_control',
    '--video-references', segmentPath,
    '--image-references', characterImagePath,
    '--mode', 'std',
    '--wait', '--json',
  ]);

  const [job] = JSON.parse(stdout);
  if (!job.result_url) {
    throw new Error(`Higgsfield job ${job.id} finished without a result_url (status: ${job.status})`);
  }

  // -f: fail (nonzero exit) on HTTP error responses instead of saving the error
  // body as if it were the video. -L: follow redirects instead of saving a
  // redirect stub.
  await execFile('curl', ['-fsSL', '-o', outputPath, job.result_url]);
  return { outputPath };
}
