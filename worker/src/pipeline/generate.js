import path from 'node:path';
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
// (Timing evidence above is from kling3_0_motion_control; neither
// hf_mult_motion_control nor ad_multiplier has been separately characterized,
// but all three are Higgsfield-hosted jobs of similar shape, so the same
// bound is used until real data says otherwise.)
const GENERATE_TIMEOUT_MS = 40 * 60 * 1000;

// Switched from hf_mult_motion_control to ad_multiplier 2026-09-21: real
// testing (docs/higgsfield-cli-notes.md) traced the "ip_detected" rejections
// ad_multiplier had been giving to the SOURCE SEGMENT'S BACKGROUND AUDIO
// (likely copyrighted trending music), not to the face-swap content itself —
// stripping the segment's audio before sending it made the same call
// complete normally. ad_multiplier also does face + product/wardrobe
// replacement in one call, where hf_mult_motion_control only does faces
// (Higgsfield's "Genjutsu" combo would need a second hf_mult_replace_object
// call for that, at double the cost), which better matches where this
// project is headed.
//
// A prompt is mandatory end to end: the CLI rejects a missing `--prompt`
// client-side ("Missing required params: prompt"), and the backend rejects an
// empty one ("prompt: String should have at least 1 character" — observed
// 2026-09-22 after an E2E run failed on it). The API never echoes the prompt
// back (`generate get` shows `prompt: null` even for completed jobs), so the
// wording below is our own, not recovered from a past success.
const FACE_SWAP_PROMPT =
  'Replace the person in the video with the person from the reference image. '
  + 'Keep the original motion, framing, lighting, and background unchanged.';

// Reference images are sent in argument order (character first, product
// second), and the prompt refers to them by that order.
const FACE_AND_PRODUCT_SWAP_PROMPT =
  'Replace the person in the video with the person from the first reference image, '
  + 'and replace the product they are holding with the product from the second reference image. '
  + 'Keep the original motion, framing, lighting, and background unchanged.';

export async function generateFromSegment(
  segmentPath,
  characterImagePath,
  outputPath,
  { execFile = defaultExecFile, productImagePath } = {},
) {
  const mutedSegmentPath = path.join(
    path.dirname(segmentPath),
    `muted-${path.basename(segmentPath)}`,
  );
  await execFile('ffmpeg', ['-y', '-i', segmentPath, '-an', '-c:v', 'copy', mutedSegmentPath]);

  const imageArgs = ['--image-references', characterImagePath];
  if (productImagePath) {
    imageArgs.push('--image-references', productImagePath);
  }
  const prompt = productImagePath ? FACE_AND_PRODUCT_SWAP_PROMPT : FACE_SWAP_PROMPT;

  const startedAt = new Date();
  let job;
  try {
    const { stdout } = await execFile(
      'higgsfield',
      [
        'generate', 'create', 'ad_multiplier',
        '--mode', 'video_edit',
        '--prompt', prompt,
        '--video-references', mutedSegmentPath,
        ...imageArgs,
        '--wait', '--json',
      ],
      { timeout: GENERATE_TIMEOUT_MS },
    );
    [job] = JSON.parse(stdout);
  } catch (error) {
    // Recoverable failures aren't limited to our own execFile timeout
    // (error.killed): observed 2026-09-17, the CLI's *own* internal wait
    // gave up first ("Error: timed out waiting for job ...", a plain
    // non-zero exit — error.killed is false) while the job had already
    // resolved server-side (to "nsfw", in that case) moments earlier.
    // Recovery is cheap and safe to attempt unconditionally: if no job
    // matching this call exists (bad args, auth failure, etc.), it finds
    // nothing and falls through to the original error unchanged.
    job = await recoverTimedOutJob(startedAt, execFile);
    if (!job) throw error;
  }

  if (!job.result_url) {
    throw new Error(`Higgsfield job ${job.id} finished without a result_url (status: ${job.status})`);
  }

  // -f: fail (nonzero exit) on HTTP error responses instead of saving the error
  // body as if it were the video. -L: follow redirects instead of saving a
  // redirect stub.
  await execFile('curl', ['-fsSL', '-o', outputPath, job.result_url]);
  return { outputPath };
}

// A local give-up (our timeout, or the CLI's own) can happen moments before
// the job it submitted resolves server-side — discarding that result would
// be a result we'd otherwise wrongly call an unrecoverable failure. Since
// jobs are processed one at a time, the most recent job created at-or-after
// this call started is ours; only use it if it has reached one of
// Higgsfield's terminal statuses (anything else — "waiting", "generating",
// "in_progress", or a future status we don't know about yet — means it's
// genuinely still going, so we leave it and surface the original error).
const TERMINAL_STATUSES = ['completed', 'failed', 'nsfw', 'ip_detected'];

async function recoverTimedOutJob(startedAt, execFile) {
  const { stdout } = await execFile('higgsfield', ['generate', 'list', '--json']);
  const jobs = JSON.parse(stdout);
  const candidate = jobs.find((j) => new Date(j.created_at) >= startedAt);
  if (!candidate || !TERMINAL_STATUSES.includes(candidate.status)) {
    return null;
  }
  return candidate;
}
