// Prices shown before spending credits. Same table as the worker (pipeline/costs.js);
// the worker records the actual credits.

export type Resolution = '480p' | '720p';
export const RESOLUTIONS: Resolution[] = ['480p', '720p'];
export const DEFAULT_RESOLUTION: Resolution = '720p';
export const PREVIEW_SECONDS = 5;
export const CREDIT_KRW = 60; // Plus plan

const PER_SECOND: Record<Resolution, number> = { '480p': 3, '720p': 7 };

export const creditsPerSecond = (resolution: Resolution | string | undefined) =>
  PER_SECOND[(resolution as Resolution) ?? DEFAULT_RESOLUTION] ?? PER_SECOND[DEFAULT_RESOLUTION];

export const previewCredits = (resolution?: Resolution | string) => PREVIEW_SECONDS * creditsPerSecond(resolution);

export const generateCredits = (seconds: number, resolution?: Resolution | string) =>
  Math.round(seconds * creditsPerSecond(resolution) * 100) / 100;

export const toKrw = (credits: number) => Math.round(credits * CREDIT_KRW);
