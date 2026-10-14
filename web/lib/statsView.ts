import type { Stats } from './workerApi';

// Pure helpers for the "시도·비용 통계" panel.

const n = (v: number) => String(Math.round(v * 100) / 100);

/** "미리보기 70 (평균 2회) + 나머지 구간 175 + 선택 단계 22.5 = 267.5크레딧 · 약 16,050원" */
export function costFormula(stats: Stats): string | null {
  const c = stats.avgCostPerCompleted;
  if (!c) return null;
  const tries = stats.avgPreviewsToApproval === null ? '' : ` (평균 ${n(stats.avgPreviewsToApproval)}회)`;
  return `미리보기 ${n(c.previewCredits)}${tries} + 나머지 구간 ${n(c.restCredits)} + 선택 단계 ${n(c.finishingCredits)}`
    + ` = ${n(c.credits)}크레딧 · 약 ${c.krw.toLocaleString('ko-KR')}원`;
}

export function targetVerdict(stats: Stats): { withinTarget: boolean; percent: number } | null {
  const c = stats.avgCostPerCompleted;
  if (!c) return null;
  return { withinTarget: c.krw <= stats.targetKrw, percent: Math.round((c.krw / stats.targetKrw) * 100) };
}

/** Bar length as a share of the most frequent reason (0 when nothing was rejected). */
export function reasonBars(reasons: Stats['rejectReasons']) {
  const max = Math.max(0, ...reasons.map((r) => r.count));
  return reasons.map((r) => ({ ...r, percent: max ? Math.round((r.count / max) * 100) : 0 }));
}
