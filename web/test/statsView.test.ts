import { expect, it } from 'vitest';
import { costFormula, reasonBars, targetVerdict } from '../lib/statsView';
import { getStats, type Stats } from '../lib/workerApi';

const base: Stats = {
  mode: 'mock', jobs: 3, approved: 2, completed: 2, avgPreviewsToApproval: 2, firstTryApprovalRate: 0.5, failedPreviews: 1,
  rejectReasons: [{ reason: '얼굴', count: 4 }, { reason: '제품', count: 1 }, { reason: '동작', count: 0 }, { reason: '배경', count: 0 }, { reason: '기타', count: 0 }],
  avgCostPerCompleted: { previewCredits: 70, restCredits: 175, finishingCredits: 22.5, credits: 267.5, krw: 16050 },
  targetKrw: 30000,
};

it('writes the cost formula from the averages', () => {
  expect(costFormula(base)).toBe('미리보기 70 (평균 2회) + 나머지 구간 175 + 선택 단계 22.5 = 267.5크레딧 · 약 16,050원');
  expect(costFormula({ ...base, avgCostPerCompleted: null })).toBeNull();
});

it('compares the average finished cost with the 30,000원 target', () => {
  expect(targetVerdict(base)).toEqual({ withinTarget: true, percent: 54 });
  expect(targetVerdict({ ...base, avgCostPerCompleted: { ...base.avgCostPerCompleted!, krw: 45000 } })).toEqual({ withinTarget: false, percent: 150 });
  expect(targetVerdict({ ...base, avgCostPerCompleted: null })).toBeNull();
});

it('scales reason bars to the largest count, keeping zero rows', () => {
  expect(reasonBars(base.rejectReasons).map((b) => [b.reason, b.percent])).toEqual([
    ['얼굴', 100], ['제품', 25], ['동작', 0], ['배경', 0], ['기타', 0],
  ]);
  expect(reasonBars(base.rejectReasons.map((r) => ({ ...r, count: 0 }))).every((b) => b.percent === 0)).toBe(true);
});

it('getStats asks the proxy for the signed-in user\'s stats', async () => {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => { urls.push(url); return new Response(JSON.stringify(base)); }) as typeof fetch;
  expect((await getStats({ fetchFn })).completed).toBe(2);
  expect(urls).toEqual(['/api/worker/stats']);
});
