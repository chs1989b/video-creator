import { execFile as defaultExecFile } from './exec.js';

// TTS jobs finish in seconds; this only guards against a hung `--wait`.
const TTS_TIMEOUT_MS = 10 * 60 * 1000;

// text2speech_v2 preset voice "Brielle" (English, female). Chosen for the first
// demo; presets are listed by `higgsfield voices list`.
export const DEFAULT_VOICE = {
  variant: 'elevenlabs',
  voiceId: 'a00bc7f3-0236-5e76-ac65-90137ce0f5a4',
  voiceType: 'preset',
};

export async function synthesizeSpeech(
  script,
  outputPath,
  { execFile = defaultExecFile, voice = DEFAULT_VOICE } = {},
) {
  const { stdout } = await execFile(
    'higgsfield',
    [
      'generate', 'create', 'text2speech_v2',
      '--prompt', script,
      '--variant', voice.variant,
      '--voice-id', voice.voiceId,
      '--voice-type', voice.voiceType,
      '--wait', '--json',
    ],
    { timeout: TTS_TIMEOUT_MS },
  );
  const [job] = JSON.parse(stdout);
  if (!job.result_url) {
    throw new Error(`Higgsfield TTS job ${job.id} finished without a result_url (status: ${job.status})`);
  }
  await execFile('curl', ['-fsSL', '-o', outputPath, job.result_url]);
  return { outputPath };
}

// Generated clips are video-only, so the voice-over becomes the sole audio
// track. `apad` + `-shortest` pads a short narration with silence up to the
// video's length and trims a long one to it, so the video length never changes.
export async function muxVoiceover(videoPath, audioPath, outputPath, { execFile = defaultExecFile } = {}) {
  await execFile('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-af', 'apad',
    '-shortest',
    outputPath,
  ]);
  return { outputPath };
}
