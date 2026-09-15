'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

export type GenerateStatusNodeData = { job: Job | null };

type Tone = 'idle' | 'active' | 'done' | 'failed';

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '대기 중', tone: 'idle' };
  if (job.status === 'failed') {
    return { text: `실패: ${job.error ?? '알 수 없는 오류'}`, tone: 'failed' };
  }
  if (job.status === 'downloading') return { text: '다운로드 중', tone: 'active' };
  if (job.status === 'segmenting') return { text: '분할 중', tone: 'active' };
  if (job.status === 'generating') {
    const done = job.segments.filter((s) => s.status === 'done').length;
    return { text: `생성 중 (${done}/${job.segments.length})`, tone: 'active' };
  }
  if (job.status === 'merging' || job.status === 'done') {
    const done = job.segments.filter((s) => s.status === 'done').length;
    return { text: `완료 (${done}/${job.segments.length})`, tone: 'done' };
  }
  return { text: '대기 중', tone: 'idle' };
}

const toneBorder: Record<Tone, string> = {
  idle: 'border-[#42424D]',
  active: 'border-[#F7F13B]',
  done: 'border-[#3BC48D]',
  failed: 'border-[#F2495C]',
};

const toneTextClass: Record<Tone, string> = {
  idle: 'text-[#72727A]',
  active: 'text-[#F7F13B]',
  done: 'text-[#3BC48D]',
  failed: 'text-[#F2495C]',
};

const toneHandleColor: Record<Tone, string> = {
  idle: '#72727A',
  active: '#F7F13B',
  done: '#3BC48D',
  failed: '#F2495C',
};

export function GenerateStatusNode({ data }: NodeProps & { data: GenerateStatusNodeData }) {
  const { text, tone } = summarize(data.job);
  return (
    <div className={`w-[240px] rounded-lg border bg-[#16161A] p-3 ${toneBorder[tone]}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#72727A', borderColor: '#72727A', width: 10, height: 10 }} />
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">생성</div>
      <div className={`text-sm ${toneTextClass[tone]}`}>{text}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: toneHandleColor[tone], borderColor: toneHandleColor[tone], width: 10, height: 10 }}
      />
    </div>
  );
}
