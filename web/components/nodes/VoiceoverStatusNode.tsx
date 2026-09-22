'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

export type VoiceoverStatusNodeData = { job: Job | null };

type Tone = 'idle' | 'active' | 'done' | 'failed';

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '대기 중', tone: 'idle' };
  if (!job.script) return { text: '건너뜀 (대본 없음)', tone: 'idle' };
  if (job.status === 'failed') {
    const allSegmentsDone = job.segments.length > 0 && job.segments.every((s) => s.status === 'done');
    return allSegmentsDone
      ? { text: `실패: ${job.error ?? '알 수 없는 오류'}`, tone: 'failed' }
      : { text: '이전 단계 실패', tone: 'failed' };
  }
  if (job.status === 'voiceover') return { text: '음성 합성 중', tone: 'active' };
  if (job.status === 'done') return { text: '완료', tone: 'done' };
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

export function VoiceoverStatusNode({ data }: NodeProps & { data: VoiceoverStatusNodeData }) {
  const { text, tone } = summarize(data.job);
  return (
    <div className={`w-[240px] rounded-lg border bg-[#16161A] p-3 ${toneBorder[tone]}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#72727A', borderColor: '#72727A', width: 10, height: 10 }} />
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">음성</div>
      <div className={`text-sm ${toneTextClass[tone]}`}>{text}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: toneHandleColor[tone], borderColor: toneHandleColor[tone], width: 10, height: 10 }}
      />
    </div>
  );
}
