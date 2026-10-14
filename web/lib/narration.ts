// The narration engine reads whatever language the script is written in.
// The UI only needs to know which sample to play and what to tell the user.
export type NarrationLanguage = 'ko' | 'en';

export function narrationLanguage(script: string): NarrationLanguage | null {
  if (!script.trim()) return null;
  return /[가-힣]/.test(script) ? 'ko' : 'en';
}

// Reading speed measured from real TTS runs (10/14 Korean 28 syllables in 4.32s,
// 9/24 English 21 words in 9.12–10.48s). Mixed scripts add both parts.
const KO_SYLLABLES_PER_SECOND = 6.5;
const EN_WORDS_PER_SECOND = 2.1;

export function estimateNarrationSeconds(script: string): number {
  const syllables = script.match(/[가-힣]/g)?.length ?? 0;
  const words = script.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0;
  return syllables / KO_SYLLABLES_PER_SECOND + words / EN_WORDS_PER_SECOND;
}

const CROSSFADE_SECONDS = 0.5; // each join in merge.js overlaps the two clips
const FLUX_MAX_SECONDS = 15; // flux_3_video_edit returns at most 15s (10/14: 16.25s in, 15.04s out)

/**
 * Length of the finished video the narration is laid over, known once the
 * source is split (after the first preview). Pass `flux` when the outfit or
 * finishing stage will redraw the video, since that caps it at 15 seconds.
 */
export function jobVideoSeconds(job: { segments: { endSeconds: number }[] } | null, flux: boolean): number | null {
  const segments = job?.segments ?? [];
  if (segments.length === 0) return null;
  const merged = segments[segments.length - 1].endSeconds - CROSSFADE_SECONDS * (segments.length - 1);
  return flux ? Math.min(merged, FLUX_MAX_SECONDS) : merged;
}

export type NarrationLengthHint = { tone: 'info' | 'warn'; text: string };

/**
 * The narration is laid over the video as is: a short one is padded with
 * silence, a long one is cut where the video ends. Say which will happen.
 */
export function narrationLengthHint(script: string, videoSeconds: number | null): NarrationLengthHint | null {
  if (!script.trim()) return null;
  const seconds = estimateNarrationSeconds(script);
  const spoken = `약 ${Math.max(1, Math.round(seconds))}초 분량`;
  if (videoSeconds === null) return { tone: 'info', text: spoken };
  const video = Math.round(videoSeconds);
  const cut = Math.round(seconds - videoSeconds);
  if (cut >= 1) return { tone: 'warn', text: `${spoken} · 영상(${video}초)보다 길어 끝 ${cut}초가 잘립니다` };
  return { tone: 'info', text: `${spoken} · 영상 ${video}초 안에 들어갑니다` };
}
