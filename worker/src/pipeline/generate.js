import { execFile as defaultExecFile } from './exec.js';

// Observed in real use (2026-09-16): the Higgsfield CLI's `--wait` can hang
// indefinitely with zero network activity and no corresponding job ever
// appearing on Higgsfield's own backend (confirmed via `higgsfield generate
// list`) — happened 3 times in one session, unrelated to input validity.
// Bound it so a hung call fails the segment instead of blocking the worker
// forever.
//
// A first attempt at 20 minutes was too tight: a real generation completed
// successfully (confirmed via `higgsfield generate get`, 17 credits charged)
// at ~20m41s — 41 seconds after our timeout had already killed the CLI and
// discarded the result. A true hang, by contrast, shows zero network
// activity for 45-60+ minutes. 40 minutes gives real (if slow) generations
// clear room while still bounding a genuine hang to a finite wait.
const GENERATE_TIMEOUT_MS = 40 * 60 * 1000;

export async function generateFromSegment(
  segmentPath,
  characterImagePath,
  outputPath,
  { execFile = defaultExecFile } = {},
) {
  const { stdout } = await execFile(
    'higgsfield',
    [
      'generate', 'workflow', 'kling3_0_motion_control',
      '--video-references', segmentPath,
      '--image-references', characterImagePath,
      '--mode', 'std',
      '--wait', '--json',
    ],
    { timeout: GENERATE_TIMEOUT_MS },
  );

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
