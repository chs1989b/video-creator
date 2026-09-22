'use client';

import type { NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';
import { NodeCard, type Tone } from './NodeCard';

export type Stage = 'generate' | 'merge' | 'edit' | 'voiceover';

export type StageNodeData = { stage: Stage; job: Job | null };

const titles: Record<Stage, string> = {
  generate: '인물·제품 교체',
  merge: '구간 이어붙이기',
  edit: '프롬프트 보정',
  voiceover: '나레이션',
};

const order: Job['status'][] = [
  'pending', 'downloading', 'segmenting', 'generating', 'merging', 'editing', 'voiceover', 'done',
];
const stageStatus: Record<Stage, Job['status']> = {
  generate: 'generating',
  merge: 'merging',
  edit: 'editing',
  voiceover: 'voiceover',
};

function summarize(stage: Stage, job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '실행을 누르면 시작합니다', tone: 'idle' };

  const skipped = (stage === 'edit' && !job.editPrompt) || (stage === 'voiceover' && !job.script);
  if (skipped) return { text: '입력이 없어 건너뜁니다', tone: 'idle' };

  const here = order.indexOf(stageStatus[stage]);
  const now = order.indexOf(job.status);

  if (job.status === 'failed') {
    const segmentsFailed = job.segments.some((s) => s.status === 'failed');
    if (stage === 'generate' && segmentsFailed) {
      const failed = job.segments.filter((s) => s.status === 'failed').length;
      return { text: `${failed}개 구간 실패 · 재시도 필요`, tone: 'failed' };
    }
    if (stage === 'generate') return { text: job.error ?? '실패', tone: 'failed' };
    return { text: '앞 단계에서 멈춤', tone: 'failed' };
  }

  if (stage === 'generate') {
    if (job.status === 'downloading') return { text: '영상 내려받는 중', tone: 'active' };
    if (job.status === 'segmenting') return { text: '10초 구간으로 나누는 중', tone: 'active' };
    if (job.status === 'generating') {
      const done = job.segments.filter((s) => s.status === 'done').length;
      return { text: `${done} / ${job.segments.length} 구간 생성됨`, tone: 'active' };
    }
    if (now > here) return { text: `${job.segments.length}개 구간 완료`, tone: 'done' };
    return { text: '대기', tone: 'idle' };
  }

  if (now === here) {
    const running: Record<Stage, string> = {
      generate: '',
      merge: '이어붙이는 중',
      edit: '보정 렌더링 중',
      voiceover: '음성 만드는 중',
    };
    return { text: running[stage], tone: 'active' };
  }
  if (now > here) return { text: '완료', tone: 'done' };
  return { text: '대기', tone: 'idle' };
}

export function StageNode({ data }: NodeProps & { data: StageNodeData }) {
  const { text, tone } = summarize(data.stage, data.job);
  return (
    <NodeCard title={titles[data.stage]} width={190} tone={tone} input output>
      <div
        className="text-[12px] leading-snug"
        style={{ color: tone === 'idle' ? 'var(--ink-muted)' : 'var(--ink)' }}
      >
        {text}
      </div>
    </NodeCard>
  );
}
