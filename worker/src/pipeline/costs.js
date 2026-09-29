// One place for every price and preview policy. Values come from real runs
// (docs/higgsfield-cli-notes.md): ad_multiplier billed 70 for 10 s and 49.28
// for 7.04 s (7 per second); FLUX edit is quoted 15 per 10 s; TTS charged 0.45.
// Where a quote and a charge differ we keep the higher number, so what the
// screen promises is never less than what gets spent.
export const CREDIT_KRW = Number(process.env.CREDIT_KRW ?? 60); // Plus plan
export const PREVIEW_SECONDS = 5;
export const PREVIEW_LIMIT = 5;

export const RATES = {
  ad_multiplier: { perSecond: 7 },
  flux_3_video_edit: { perTenSeconds: 15 },
  text2speech_v2: { perCall: 0.45 },
};

const round2 = (n) => Math.round(n * 100) / 100;

export function estimateCredits(model, { seconds = 0 } = {}) {
  const rate = RATES[model];
  if (!rate) throw new Error(`Unknown model: ${model}`);
  if (rate.perSecond) return round2(rate.perSecond * seconds);
  if (rate.perTenSeconds) return rate.perTenSeconds * Math.ceil(seconds / 10);
  return rate.perCall;
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
  return estimateCredits(STAGE_MODEL[stage], { seconds: videoSeconds(job) });
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
  return { previews: attempts.length, credits, krw: toKrw(credits) };
}

export function estimateRemaining(job) {
  const items = [];
  const pending = job.segments.filter((s) => s.status !== 'done');
  if (job.stages.generate.status !== 'done' && pending.length > 0) {
    const seconds = pending.reduce((sum, s) => sum + segmentSeconds(s), 0);
    items.push({ stage: 'generate', credits: estimateCredits('ad_multiplier', { seconds }) });
  }
  for (const stage of PRICED_STAGES) {
    if (['pending', 'failed'].includes(job.stages[stage]?.status)) {
      items.push({ stage, credits: stageCredits(job, stage) });
    }
  }
  const credits = round2(items.reduce((sum, i) => sum + i.credits, 0));
  return { items, credits, krw: toKrw(credits) };
}
