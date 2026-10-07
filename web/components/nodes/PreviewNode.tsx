'use client';

import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { Attempt, Job, Verdict } from '../../lib/workerApi';
import { REJECT_REASONS } from '../../lib/workerApi';
import { latestAttempt, previewStatus } from '../../lib/previewRules';
import { NodeCard } from './NodeCard';
import { PromptRefiner } from '../PromptRefiner';

export type PreviewNodeData = {
  job: Job | null;
  /** Present when a new preview can be started right now. */
  onRunPreview: (() => void) | null;
  onVerdict: ((attemptId: string, verdict: Verdict, reasons: string[]) => void) | null;
  /** Present when the limit is reached and one more preview may be allowed. */
  onUnlock: (() => void) | null;
  attemptUrl: (attemptId: string) => string;
  previewCredits: number;
  /** What to change in the next preview (English, optional). */
  prompt: string;
  onPromptChange: (value: string) => void;
};

function pastLabel(a: Attempt): string {
  if (a.status === 'failed') return `${a.n}회 · 실패 (0크레딧)`;
  if (a.verdict === 'reject') return `${a.n}회 · 거절${a.reasons.length ? ` (${a.reasons.join(', ')})` : ''}`;
  if (a.verdict === 'approve') return `${a.n}회 · 승인`;
  return `${a.n}회 · 판정 전`;
}

export function PreviewNode({ data }: NodeProps & { data: PreviewNodeData }) {
  const { job } = data;
  const [reasons, setReasons] = useState<string[]>([]);
  const { text, tone } = previewStatus(job);
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

      {data.onRunPreview && job && job.attempts.length > 0 && (
        <div className="mt-2 space-y-1">
          <textarea
            value={data.prompt}
            onChange={(e) => data.onPromptChange(e.target.value)}
            rows={2}
            placeholder="다음 미리보기에서 바꿀 점 (선택) 예: 얼굴을 더 닮게. 한국어로 적고 다듬기를 누르세요"
            className="nodrag w-full resize-none rounded-md border border-[var(--card-border)] bg-[var(--well)] px-2 py-1.5 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
          />
          <PromptRefiner
            stage="face"
            request={data.prompt}
            rejectReasons={latest?.verdict === 'reject' ? latest.reasons : []}
            onApply={data.onPromptChange}
          />
          <div className="text-[11px] text-[var(--ink-muted)]">인물·제품 사진을 바꾸면 다음 미리보기부터 적용됩니다</div>
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
