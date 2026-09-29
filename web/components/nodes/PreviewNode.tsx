'use client';

import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { Attempt, Job, Verdict } from '../../lib/workerApi';
import { REJECT_REASONS, usedPreviews } from '../../lib/workerApi';
import { latestAttempt } from '../../lib/previewRules';
import { NodeCard, type Tone } from './NodeCard';

export type PreviewNodeData = {
  job: Job | null;
  /** Present when a new preview can be started right now. */
  onRunPreview: (() => void) | null;
  onVerdict: ((attemptId: string, verdict: Verdict, reasons: string[]) => void) | null;
  /** Present when the limit is reached and one more preview may be allowed. */
  onUnlock: (() => void) | null;
  attemptUrl: (attemptId: string) => string;
  previewCredits: number;
};

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '입력을 채우고 5초 미리보기를 만드세요', tone: 'idle' };
  if (!job.previewRequired) return { text: '미리보기 없이 만든 작업', tone: 'idle' };
  if (job.status === 'running' && job.currentStage === 'preview') return { text: '5초 미리보기 만드는 중', tone: 'active' };
  if (job.approvedAttemptId) return { text: `승인됨 · 미리보기 ${usedPreviews(job)}회`, tone: 'done' };
  const latest = latestAttempt(job);
  if (latest?.status === 'failed') return { text: latest.error ?? '미리보기 실패', tone: 'failed' };
  return { text: `${usedPreviews(job)} / ${job.previewLimit}회 사용`, tone: job.attempts.length ? 'active' : 'idle' };
}

function pastLabel(a: Attempt): string {
  if (a.status === 'failed') return `${a.n}회 · 실패 (0크레딧)`;
  if (a.verdict === 'reject') return `${a.n}회 · 거절${a.reasons.length ? ` (${a.reasons.join(', ')})` : ''}`;
  if (a.verdict === 'approve') return `${a.n}회 · 승인`;
  return `${a.n}회 · 판정 전`;
}

export function PreviewNode({ data }: NodeProps & { data: PreviewNodeData }) {
  const { job } = data;
  const [reasons, setReasons] = useState<string[]>([]);
  const { text, tone } = summarize(job);
  const latest = latestAttempt(job);
  const judging = Boolean(
    job && latest && latest.status === 'done' && latest.verdict === null && !job.approvedAttemptId && job.status !== 'running',
  );
  const toggle = (r: string) => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const past = (job?.attempts ?? []).filter((a) => a !== latest || !judging);

  return (
    <NodeCard title="미리보기 (5초)" width={240} tone={tone} input output>
      <div className="text-[13px] leading-snug" style={{ color: tone === 'idle' ? 'var(--ink-muted)' : 'var(--ink)' }}>
        {text}
      </div>

      {latest?.status === 'done' && (
        <div className="mt-2 aspect-video w-full overflow-hidden rounded-md bg-[var(--well)]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={latest.id} src={data.attemptUrl(latest.id)} controls muted playsInline preload="metadata" className="h-full w-full object-cover" />
        </div>
      )}

      {judging && latest && data.onVerdict && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className={`rounded-full border px-2 py-0.5 text-[11.5px] ${reasons.includes(r) ? 'border-[var(--danger)] text-[var(--ink)]' : 'border-[var(--card-border-strong)] text-[var(--ink-muted)]'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { data.onVerdict?.(latest.id, 'approve', []); setReasons([]); }}
              className="flex-1 rounded-md border border-[var(--media)] py-1.5 text-[12.5px] font-medium text-[var(--ink)] hover:bg-[var(--media)] hover:text-black"
            >
              이걸로 승인
            </button>
            <button
              type="button"
              onClick={() => { data.onVerdict?.(latest.id, 'reject', reasons); setReasons([]); }}
              className="flex-1 rounded-md border border-[var(--card-border-strong)] py-1.5 text-[12.5px] text-[var(--ink)] hover:border-[var(--danger)]"
            >
              거절
            </button>
          </div>
        </div>
      )}

      {data.onRunPreview && (
        <button
          type="button"
          onClick={data.onRunPreview}
          className="mt-2 w-full rounded-md border border-[var(--card-border-strong)] py-1.5 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--media)] hover:text-[var(--media)]"
        >
          미리보기 만들기 · 약 {data.previewCredits}크레딧
        </button>
      )}

      {data.onUnlock && (
        <button
          type="button"
          onClick={data.onUnlock}
          className="mt-2 w-full rounded-md border border-[var(--danger)] py-1.5 text-[12.5px] text-[var(--ink)]"
        >
          한도 도달 · 1회 더 허용
        </button>
      )}

      {past.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-[var(--ink-muted)]">
          {past.map((a) => <li key={a.id}>{pastLabel(a)}</li>)}
        </ul>
      )}
    </NodeCard>
  );
}
