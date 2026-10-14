// One place for every price and preview policy. Values come from real runs
// (docs/higgsfield-cli-notes.md): ad_multiplier billed 70 for 10 s and 49.28
// for 7.04 s (7 per second); FLUX edit is quoted 15 per 10 s; TTS charged 0.45.
// Where a quote and a charge differ we keep the higher number, so what the
// screen promises is never less than what gets spent.
export const CREDIT_KRW = Number(process.env.CREDIT_KRW ?? 60); // Plus plan
export const PREVIEW_SECONDS = 5;
export const PREVIEW_LIMIT = 5;

// Generation resolution, chosen per job. 2026-10-14 `generate cost` for the same
// 10 s segment: 480p 30, 720p 70, 1080p 160 (1080p left out: far over the target).
export const RESOLUTIONS = ['480p', '720p'];
export const DEFAULT_RESOLUTION = '720p';

export const RATES = {
  ad_multiplier: { perSecondByResolution: { '480p': 3, '720p': 7 } },
  // Measured 10/14 from account transactions (docs/higgsfield-cli-notes.md):
  // FLUX bills about 1 credit per second, at most 15 (9.71 s → 9.71, 15.04 s → 15,
  // 17.04 s → 15; longer videos not measured yet). TTS bills 0.15 per started
  // 40 characters (39 → 0.15, 69 → 0.3, 117 → 0.45).
  flux_3_video_edit: { perSecond: 1, max: 15 },
  text2speech_v2: { perCharacters: 40, perUnit: 0.15 },
};

const round2 = (n) => Math.round(n * 100) / 100;

export function estimateCredits(model, { seconds = 0, resolution = DEFAULT_RESOLUTION, characters = 0 } = {}) {
  const rate = RATES[model];
  if (!rate) throw new Error(`Unknown model: ${model}`);
  if (rate.perSecondByResolution) {
    const perSecond = rate.perSecondByResolution[resolution];
    if (perSecond === undefined) throw new Error(`Unknown resolution: ${resolution}`);
    return round2(perSecond * seconds);
  }
  if (rate.perSecond) return round2(Math.min(rate.perSecond * seconds, rate.max ?? Infinity));
  return round2(Math.ceil(characters / rate.perCharacters) * rate.perUnit);
}

export function segmentSeconds(segment) {
  return segment.endSeconds - segment.startSeconds;
}

export function videoSeconds(job) {
  return job.segments.length ? Math.max(...job.segments.map((s) => s.endSeconds)) : 0;
}

export const PRICED_STAGES = ['restyle', 'edit', 'voiceover'];
const STAGE_MODEL = { restyle: 'flux_3_video_edit', edit: 'flux_3_video_edit', voiceover: 'text2speech_v2' };

export function stageCredits(job, stage) {
  return estimateCredits(STAGE_MODEL[stage], { seconds: videoSeconds(job), characters: job.script?.length ?? 0 });
}

export function toKrw(credits) {
  return Math.round(credits * CREDIT_KRW);
}

export function jobTotals(job) {
  const attempts = job.attempts ?? [];
  const previewCredits = attempts.reduce((sum, a) => sum + (a.credits ?? 0), 0);
  const segmentCredits = job.segments.reduce((sum, s) => sum + (s.credits ?? 0), 0);
  const finishing = PRICED_STAGES.reduce((sum, s) => sum + (job.stages?.[s]?.credits ?? 0), 0);
  const credits = round2(previewCredits + segmentCredits + finishing);
  // Failed previews are refunded and do not use up the limit, so they are not counted here either.
  const previews = attempts.filter((a) => a.status !== 'failed').length;
  return { previews, credits, krw: toKrw(credits) };
}

export function estimateRemaining(job) {
  const items = [];
  const pending = job.segments.filter((s) => s.status !== 'done');
  if (job.stages.generate.status !== 'done' && pending.length > 0) {
    const seconds = pending.reduce((sum, s) => sum + segmentSeconds(s), 0);
    items.push({ stage: 'generate', credits: estimateCredits('ad_multiplier', { seconds, resolution: job.resolution }) });
  }
  for (const stage of PRICED_STAGES) {
    if (['pending', 'failed'].includes(job.stages[stage]?.status)) {
      items.push({ stage, credits: stageCredits(job, stage) });
    }
  }
  const credits = round2(items.reduce((sum, i) => sum + i.credits, 0));
  return { items, credits, krw: toKrw(credits) };
}
