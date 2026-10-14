import { expect, it } from 'vitest';
import { resolutionOptions, previewCreditsFor, toKrw, optionalStageCosts, type PriceTable } from '../lib/costs';
import { createJob } from '../lib/workerApi';
import { generateButtonLabel } from '../components/nodes/StageNode';
import type { Job } from '../lib/workerApi';

// What the worker's GET /config sends; the web keeps no prices of its own.
const PRICES: PriceTable = {
  creditKrw: 60, previewSeconds: 5, defaultResolution: '720p', perSecondByResolution: { '480p': 3, '720p': 7 },
  flux: { perSecond: 1, max: 15 }, tts: { perCharacters: 40, perUnit: 0.15 },
};

it('resolution choices and their preview price come from the worker table', () => {
  expect(resolutionOptions(PRICES)).toEqual([
    { resolution: '480p', previewCredits: 15 },
    { resolution: '720p', previewCredits: 35 },
  ]);
  expect(previewCreditsFor(PRICES, '480p')).toBe(15);
  expect(previewCreditsFor(PRICES, 'unknown')).toBe(35); // falls back to the worker's default
  expect(toKrw(PRICES, 15)).toBe(900);
  // A price change on the worker shows up without touching the web.
  expect(previewCreditsFor({ ...PRICES, perSecondByResolution: { '480p': 4, '720p': 7 } }, '480p')).toBe(20);
});

it('the generate button price is the worker estimate for the remaining segments', () => {
  const job = {
    segments: [
      { index: 0, startSeconds: 0, endSeconds: 5, status: 'done' },
      { index: 1, startSeconds: 5, endSeconds: 17.04, status: 'pending' },
    ],
    estimate: { items: [{ stage: 'generate', credits: 36.12 }], credits: 36.12, krw: 2167, previewCredits: null },
  } as unknown as Job;
  expect(generateButtonLabel(job, false)).toBe('나머지 12초 만들기 · 약 36.12크레딧');
});

it('createJob sends the chosen resolution', async () => {
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => { calls.push({ init }); return new Response('{}'); }) as typeof fetch;
  await createJob({ youtubeUrl: 'https://e.com/v.mp4', characterImage: new File(['x'], 'c.png'), resolution: '480p' }, { fetchFn });
  expect((calls[0].init?.body as FormData).get('resolution')).toBe('480p');
});

it('the palette cost lines are built from the worker table, and say nothing until it is known', () => {
  expect(optionalStageCosts(PRICES)).toEqual({
    restyle: '초당 약 1크레딧, 최대 15',
    edit: '초당 약 1크레딧, 최대 15',
    voiceover: '대본 40자마다 0.15크레딧',
  });
  expect(optionalStageCosts(null)).toEqual({ restyle: '', edit: '', voiceover: '' });
});
