'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

export type MergeStatusNodeData = { job: Job | null };

type Tone = 'idle' | 'active' | 'done' | 'failed';

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '대기 중', tone: 'idle' };
  if (job.status === 'failed') {
    const allSegmentsDone = job.segments.length > 0 && job.segments.every((s) => s.status === 'done');
    if (allSegmentsDone) {
      return { text: `실패: ${job.error ?? '알 수 없는 오류'}`, tone: 'failed' };
    }
    return { text: '이전 단계 실패', tone: 'failed' };
  }
  if (job.status === 'merging') return { text: '병합 중', tone: 'active' };
  if (job.status === 'done') return { text: '완료', tone: 'done' };
  return { text: '대기 중', tone: 'idle' };
}

const toneClasses: Record<Tone, string> = {
  idle: 'border-slate-700 bg-slate-900 text-slate-400',
  active: 'border-amber-500 bg-amber-950 text-amber-200',
  done: 'border-emerald-500 bg-emerald-950 text-emerald-200',
  failed: 'border-red-500 bg-red-950 text-red-200',
};

export function MergeStatusNode({ data }: NodeProps & { data: MergeStatusNodeData }) {
  const { text, tone } = summarize(data.job);
  return (
    <div className={`w-56 rounded-lg border p-3 shadow-lg ${toneClasses[tone]}`}>
      <Handle type="target" position={Position.Left} />
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">병합</div>
      <div className="text-sm">{text}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
