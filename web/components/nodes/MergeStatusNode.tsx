'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

export type MergeStatusNodeData = { job: Job | null };

type Tone = 'idle' | 'active' | 'done' | 'failed';

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '대기 중', tone: 'idle' };
  if (job.status === 'failed') {
    return { text: job.status === 'failed' ? '이전 단계 실패' : '대기 중', tone: 'failed' };
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
