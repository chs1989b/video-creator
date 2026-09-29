// Kept apart from jobRunner.js so db.js can build a new job's stage record
// without importing the pipeline (and its ffmpeg/CLI wrappers).
export const STAGE_ORDER = ['generate', 'merge', 'restyle', 'edit', 'voiceover'];

export function initialStages({ restylePrompt, editPrompt, script }) {
  const stage = (enabled) => ({ status: enabled ? 'pending' : 'skipped', outputPath: null, error: null });
  return {
    generate: stage(true),
    merge: stage(true),
    restyle: stage(Boolean(restylePrompt)),
    edit: stage(Boolean(editPrompt)),
    voiceover: stage(Boolean(script)),
  };
}
