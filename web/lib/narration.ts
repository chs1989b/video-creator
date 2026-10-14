// The narration engine reads whatever language the script is written in.
// The UI only needs to know which sample to play and what to tell the user.
export type NarrationLanguage = 'ko' | 'en';

export function narrationLanguage(script: string): NarrationLanguage | null {
  if (!script.trim()) return null;
  return /[가-힣]/.test(script) ? 'ko' : 'en';
}
