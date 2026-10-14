// Narration voices: two female, two male, all ElevenLabs presets that read
// both Korean and English. Higgsfield lists voices by name only (no gender or
// language), so these four were picked on 2026-10-14 by generating the same
// sentence with ten candidates and measuring the median pitch
// (female 180–225 Hz, male 113–132 Hz; docs/superpowers/plans/2026-10-14-voices.md).

const preset = (voiceId) => ({ variant: 'elevenlabs', voiceId, voiceType: 'preset' });

export const VOICES = [
  { key: 'female-1', label: '여성 1', name: 'Brielle', gender: 'female', ...preset('a00bc7f3-0236-5e76-ac65-90137ce0f5a4') },
  { key: 'female-2', label: '여성 2', name: 'Hana', gender: 'female', ...preset('c25f78a0-714e-42af-8da3-a399cef94968') },
  { key: 'male-1', label: '남성 1', name: 'Marcus', gender: 'male', ...preset('6f98d3dd-324f-4845-8c28-c1d1647a06cd') },
  { key: 'male-2', label: '남성 2', name: 'Ken', gender: 'male', ...preset('ceee41dc-0ee8-59a7-b3e8-2744116fcb5e') },
];

export const DEFAULT_VOICE_KEY = 'female-1';

export const isVoiceKey = (key) => VOICES.some((v) => v.key === key);

/** The text2speech_v2 voice for a job; jobs without a choice use the default. */
export function voiceFor(key) {
  const voice = VOICES.find((v) => v.key === (key ?? DEFAULT_VOICE_KEY));
  if (!voice) throw new Error(`Unknown voice: ${key}`);
  return { variant: voice.variant, voiceId: voice.voiceId, voiceType: voice.voiceType };
}
