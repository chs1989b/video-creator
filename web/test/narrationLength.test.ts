import { expect, it } from 'vitest';
import { estimateNarrationSeconds, jobVideoSeconds, narrationLengthHint } from '../lib/narration';

// Real 10/14 and 9/24 TTS runs: the Korean line read in 4.32s, the English one in 9.12–10.48s.
const KO = '이 아이라이너는 한 번에 부드럽게 그려지고, 하루 종일 번지지 않아요.';
const EN = "Hi everyone! Today I'm showing you my go-to eyeliner. It glides on smoothly, dries in seconds, and stays put all day.";

it('estimates reading time close to the measured runs', () => {
  expect(estimateNarrationSeconds('')).toBe(0);
  expect(estimateNarrationSeconds(KO)).toBeCloseTo(4.3, 0);
  expect(estimateNarrationSeconds(EN)).toBeGreaterThan(9);
  expect(estimateNarrationSeconds(EN)).toBeLessThan(10.6);
});

it('the finished length: source minus 0.5s per crossfade, capped at 15s when FLUX redraws it', () => {
  expect(jobVideoSeconds(null, false)).toBeNull();
  expect(jobVideoSeconds({ segments: [] }, false)).toBeNull();
  const job = { segments: [{ endSeconds: 5 }, { endSeconds: 17.04 }] };
  // Real 10/14 job: source 17.04s -> merged 16.25s -> after FLUX 15.04s.
  expect(jobVideoSeconds(job, false)).toBeCloseTo(16.54, 2);
  expect(jobVideoSeconds(job, true)).toBe(15);
  expect(jobVideoSeconds({ segments: [{ endSeconds: 5 }, { endSeconds: 12 }] }, true)).toBeCloseTo(11.5, 2);
});

it('no script, no hint; unknown video length shows only the estimate', () => {
  expect(narrationLengthHint('  ', 15)).toBeNull();
  expect(narrationLengthHint(KO, null)).toEqual({ tone: 'info', text: '약 4초 분량' });
});

it('a script that fits says so', () => {
  expect(narrationLengthHint(KO, 15.04)).toEqual({ tone: 'info', text: '약 4초 분량 · 영상 15초 안에 들어갑니다' });
});

it('a script longer than the video warns how much will be cut', () => {
  expect(narrationLengthHint(EN + ' ' + EN, 15.04)).toEqual({
    tone: 'warn',
    text: '약 20초 분량 · 영상(15초)보다 길어 끝 5초가 잘립니다',
  });
});
