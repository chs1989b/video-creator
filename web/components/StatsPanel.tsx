'use client';

import { useCallback, useEffect, useState } from 'react';
import { getStats, type Stats } from '../lib/workerApi';
import { costFormula, reasonBars, targetVerdict } from '../lib/statsView';

type Props = {
  /** Changes whenever a job moves on, so an open panel stays fresh. */
  refreshKey: string;
  /** Controlled by the canvas so only one bottom-right panel is open at a time. */
  open: boolean;
  onToggle: () => void;
};

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[var(--card-border)] px-3 py-2.5">
      <div className="text-[20px] font-semibold leading-tight text-[var(--ink)]">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{sub}</div>}
    </div>
  );
}

/**
 * "시도·비용 통계": the course formula (a finished video = one try × number of
 * tries) from the signed-in user's own jobs.
 */
export function StatsPanel({ refreshKey, open, onToggle }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await getStats());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  const formula = stats ? costFormula(stats) : null;
  const target = stats ? targetVerdict(stats) : null;
  const bars = stats ? reasonBars(stats.rejectReasons) : [];
  const rejected = bars.reduce((sum, b) => sum + b.count, 0);
  const mock = stats?.mode === 'mock';

  return (
    <div className="relative flex flex-col items-end">
      {open && (
        <div
          role="dialog"
          aria-label="시도·비용 통계"
          className="absolute bottom-full right-0 mb-2 w-[420px] max-w-[calc(100vw-40px)] rounded-[12px] border border-[var(--card-border-strong)] bg-[var(--card)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-[var(--ink)]">시도·비용 통계</span>
            <button type="button" onClick={load} className="text-[11.5px] text-[var(--ink-muted)] hover:text-[var(--ink)]">새로고침</button>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-muted)]">
            완성 1편 비용 = 시도 1회 비용 × 시도 횟수. 내 작업 기록으로 계산합니다.
            {mock && ' 테스트 모드 기록이라 금액은 "실제였다면" 기준입니다.'}
          </p>

          {error && <div className="mt-3 text-[12px] text-[var(--danger)]">{error}</div>}
          {stats && stats.jobs === 0 && (
            <div className="mt-4 rounded-md bg-[var(--well)] px-3 py-6 text-center text-[12.5px] text-[var(--ink-muted)]">
              아직 미리보기를 만든 작업이 없습니다.
            </div>
          )}

          {stats && stats.jobs > 0 && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Tile value={`${stats.completed}편`} label="완성" sub={`작업 ${stats.jobs} · 승인 ${stats.approved}`} />
                <Tile
                  value={stats.avgPreviewsToApproval === null ? '—' : `${stats.avgPreviewsToApproval}회`}
                  label="승인까지 평균 미리보기"
                  sub={stats.failedPreviews ? `실패 ${stats.failedPreviews}회는 환불되어 제외` : undefined}
                />
                <Tile
                  value={stats.firstTryApprovalRate === null ? '—' : `${Math.round(stats.firstTryApprovalRate * 100)}%`}
                  label="첫 미리보기에서 승인"
                />
                <Tile
                  value={stats.avgCostPerCompleted ? `${stats.avgCostPerCompleted.krw.toLocaleString('ko-KR')}원` : '—'}
                  label={`완성 1편 평균${mock ? ' (실제였다면)' : ''}`}
                  sub={target ? `목표 ${stats.targetKrw.toLocaleString('ko-KR')}원의 ${target.percent}% · ${target.withinTarget ? '목표 안' : '목표 초과'}` : '완성된 작업이 아직 없습니다'}
                />
              </div>

              {formula && (
                <div className="mt-3 rounded-md bg-[var(--well)] px-3 py-2 text-[12px] leading-snug text-[var(--ink)]">{formula}</div>
              )}

              <div className="mt-4 text-[12.5px] font-medium text-[var(--ink)]">거절 사유 <span className="font-normal text-[var(--ink-muted)]">({rejected}건)</span></div>
              {rejected === 0 ? (
                <div className="mt-1 text-[12px] text-[var(--ink-muted)]">거절한 미리보기가 아직 없습니다.</div>
              ) : (
                <ul className="mt-2 space-y-[2px]">
                  {bars.map((b) => (
                    <li key={b.reason} className="grid grid-cols-[44px_1fr_28px] items-center gap-2 py-[3px]" title={`${b.reason}: ${b.count}건`}>
                      <span className="text-[12px] text-[var(--ink-muted)]">{b.reason}</span>
                      <span className="h-[10px] rounded-r-[4px] bg-[var(--well)]">
                        {b.count > 0 && (
                          <span className="block h-full rounded-r-[4px] bg-[var(--chart-1)]" style={{ width: `${Math.max(b.percent, 4)}%` }} />
                        )}
                      </span>
                      <span className="text-right text-[12px] tabular-nums text-[var(--ink)]">{b.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="rounded-full border border-[var(--card-border-strong)] bg-[var(--pill)] px-4 py-2 text-[12.5px] text-[var(--ink)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur hover:border-[var(--media)]"
      >
        통계
      </button>
    </div>
  );
}
