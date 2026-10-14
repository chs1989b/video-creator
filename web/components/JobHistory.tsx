'use client';

import { useCallback, useEffect, useState } from 'react';
import { listJobs, type Job } from '../lib/workerApi';
import { historyRow } from '../lib/jobHistory';
import { toneColor } from './nodes/NodeCard';

type Props = {
  currentJobId: string | null;
  /** Changes whenever the current job moves on, so an open list stays fresh. */
  refreshKey: string;
  onOpen: (jobId: string) => void;
  /** Controlled by the canvas so only one bottom-right panel is open at a time. */
  open: boolean;
  onToggle: () => void;
};

/** "내 작업": the signed-in user's jobs, newest first; pick one to load it onto the canvas. */
export function JobHistory({ currentJobId, refreshKey, onOpen, open, onToggle }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await listJobs());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="relative flex flex-col items-end">
      {open && (
        <div
          role="dialog"
          aria-label="내 작업 목록"
          className="absolute bottom-full right-0 mb-2 w-[360px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[12px] border border-[var(--card-border-strong)] bg-[var(--card)] shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--card-border)] px-3.5 py-2.5">
            <span className="text-[13px] font-medium text-[var(--ink)]">내 작업</span>
            <button type="button" onClick={load} className="text-[11.5px] text-[var(--ink-muted)] hover:text-[var(--ink)]">새로고침</button>
          </div>
          <ul className="max-h-[360px] overflow-y-auto">
            {error && <li className="px-3.5 py-3 text-[12px] text-[var(--danger)]">{error}</li>}
            {jobs?.length === 0 && <li className="px-3.5 py-6 text-center text-[12px] text-[var(--ink-muted)]">아직 만든 작업이 없습니다.</li>}
            {jobs?.map((job) => {
              const row = historyRow(job);
              const current = job.id === currentJobId;
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => { onOpen(job.id); onToggle(); }}
                    className={`block w-full border-b border-[var(--card-border)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--well)] ${current ? 'bg-[var(--well)]' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11.5px] text-[var(--ink-muted)]">
                        {row.shortId}{current && <span className="ml-1.5 font-sans text-[var(--media)]">· 지금 캔버스</span>}
                      </span>
                      <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink)]">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: toneColor[row.tone] }} />
                        {row.status}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11.5px] text-[var(--ink-muted)]">
                      <span>시작 {row.started}</span>
                      <span>완료 {row.finished}{row.duration ? ` (${row.duration})` : ''}</span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[var(--ink-faint)]">
                      {row.mock ? '테스트 모드 · ' : ''}{row.cost}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="rounded-full border border-[var(--card-border-strong)] bg-[var(--pill)] px-4 py-2 text-[12.5px] text-[var(--ink)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur hover:border-[var(--media)]"
      >
        내 작업{jobs ? ` ${jobs.length}` : ''}
      </button>
    </div>
  );
}
