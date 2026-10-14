import { expect, it } from 'vitest';
import { RESOLUTIONS, creditsPerSecond, previewCredits, generateCredits, toKrw } from '../lib/costs';
import { createJob } from '../lib/workerApi';

it('prices the face swap by resolution, the same table as the worker', () => {
  expect(RESOLUTIONS).toEqual(['480p', '720p']);
  expect(creditsPerSecond('480p')).toBe(3);
  expect(creditsPerSecond('720p')).toBe(7);
  expect(creditsPerSecond(undefined)).toBe(7);
  expect(previewCredits('480p')).toBe(15);
  expect(previewCredits('720p')).toBe(35);
  expect(generateCredits(25, '480p')).toBe(75);
  expect(toKrw(15)).toBe(900);
});

it('createJob sends the chosen resolution', async () => {
  const calls: Array<{ init?: RequestInit }> = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => { calls.push({ init }); return new Response('{}'); }) as typeof fetch;
  await createJob({ youtubeUrl: 'https://e.com/v.mp4', characterImage: new File(['x'], 'c.png'), resolution: '480p' }, { fetchFn });
  expect((calls[0].init?.body as FormData).get('resolution')).toBe('480p');
});
