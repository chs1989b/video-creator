// Prices shown before spending credits. The web keeps no numbers of its own:
// the table comes from the worker (GET /config → prices) and the remaining cost
// of a job from its `estimate`, both built from worker/src/pipeline/costs.js.

export type Resolution = '480p' | '720p';
/** The picker's starting choice before the user picks; prices still come from the worker. */
export const DEFAULT_RESOLUTION: Resolution = '720p';

export type PriceTable = {
  creditKrw: number;
  previewSeconds: number;
  defaultResolution: string;
  perSecondByResolution: Record<string, number>;
  flux: { perSecond: number; max: number };
  tts: { perCharacters: number; perUnit: number };
};

const perSecond = (prices: PriceTable, resolution: string | undefined) =>
  prices.perSecondByResolution[resolution ?? prices.defaultResolution]
  ?? prices.perSecondByResolution[prices.defaultResolution];

export const previewCreditsFor = (prices: PriceTable, resolution: string | undefined) =>
  prices.previewSeconds * perSecond(prices, resolution);

/** The resolution buttons: every resolution the worker prices, with one preview's cost. */
export const resolutionOptions = (prices: PriceTable) =>
  Object.keys(prices.perSecondByResolution).map((resolution) => ({
    resolution,
    previewCredits: previewCreditsFor(prices, resolution),
  }));

export const toKrw = (prices: PriceTable, credits: number) => Math.round(credits * prices.creditKrw);

/** The palette's cost line for each priced optional stage (empty until the table arrives). */
export function optionalStageCosts(prices: PriceTable | null): Record<'restyle' | 'edit' | 'voiceover', string> {
  if (!prices) return { restyle: '', edit: '', voiceover: '' };
  const flux = `초당 약 ${prices.flux.perSecond}크레딧, 최대 ${prices.flux.max}`;
  return {
    restyle: flux,
    edit: flux,
    voiceover: `대본 ${prices.tts.perCharacters}자마다 ${prices.tts.perUnit}크레딧`,
  };
}
