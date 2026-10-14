import { expect, it } from 'vitest';
import { narrationLanguage } from '../lib/narration';
import { createJob, updateJobInputs, getVoices, voiceSampleUrl } from '../lib/workerApi';

it('reads Korean scripts in Korean and everything else in English', () => {
  expect(narrationLanguage('이 아이라이너는 번지지 않아요.')).toBe('ko');
  expect(narrationLanguage('This eyeliner stays put. 정말요!')).toBe('ko');
  expect(narrationLanguage('This eyeliner stays put.')).toBe('en');
  expect(narrationLanguage('')).toBe(null);
});

const recording = (body: unknown = { id: 'j' }) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body)); }) as typeof fetch;
  return { calls, fetchFn };
};

it('sends the chosen voice when creating and when editing a job', async () => {
  const a = recording();
  await createJob({ youtubeUrl: 'https://e.com/v.mp4', characterImage: new File(['x'], 'c.png'), voiceKey: 'male-1' }, { fetchFn: a.fetchFn });
  expect((a.calls[0].init?.body as FormData).get('voiceKey')).toBe('male-1');

  const b = recording();
  await updateJobInputs('j', { voiceKey: 'female-2' }, { fetchFn: b.fetchFn });
  expect(JSON.parse(String(b.calls[0].init?.body))).toEqual({ voiceKey: 'female-2' });
});

it('lists voices through the proxy and builds sample URLs', async () => {
  const c = recording([{ key: 'female-1', label: '여성 1', name: 'Brielle', gender: 'female', samples: { ko: true, en: true } }]);
  expect((await getVoices({ fetchFn: c.fetchFn }))[0].label).toBe('여성 1');
  expect(c.calls[0].url).toBe('/api/worker/voices');
  expect(voiceSampleUrl('male-2', 'ko')).toBe('/api/worker/voices/male-2/sample?lang=ko');
});
