'use client';

import type { NodeProps } from '@xyflow/react';
import type { Job, StageName } from '../../lib/workerApi';
import { STAGE_ORDER } from '../../lib/workerApi';
import { NodeCard, type Tone } from './NodeCard';

export type Stage = StageName;

export type StageNodeData = {
  stage: Stage;
  job: Job | null;
  outputUrl: string | null;
  /** Present when this stage can be started by hand right now. */
  onRun: (() => void) | null;
  /** Present for the generate stage when segments failed. */
  onRetrySegment: ((index: number) => void) | null;
};

const titles: Record<Stage, string> = {
  generate: '인물·제품 교체',
  merge: '구간 이어붙이기',
  restyle: '의상·배경 교체',
  edit: '프롬프트 보정',
  voiceover: '나레이션',
};

const runningText: Record<Stage, string> = {
  generate: '구간 생성 중',
  merge: '이어붙이는 중',
  restyle: '의상·배경 렌더링 중',
  edit: '보정 렌더링 중',
  voiceover: '음성 만드는 중',
};

export function canRunStage(job: Job | null, stage: Stage): boolean {
  if (!job || job.status === 'running') return false;
  const state = job.stages[stage];
  if (!state || state.status === 'skipped' || state.status === 'done') return false;
  const earlier = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
  return earlier.every((s) => ['done', 'skipped'].includes(job.stages[s]?.status));
}

function summarize(stage: Stage, job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '입력을 채우고 실행하세요', tone: 'idle' };
  const state = job.stages[stage];
  if (!state) return { text: '대기', tone: 'idle' };

  switch (state.status) {
    case 'skipped':
      return { text: '입력이 없어 건너뜁니다', tone: 'idle' };
    case 'running':
      if (stage === 'generate') {
        if (job.segments.length === 0) return { text: '영상 내려받고 나누는 중', tone: 'active' };
        const done = job.segments.filter((s) => s.status === 'done').length;
        return { text: `${done} / ${job.segments.length} 구간 생성됨`, tone: 'active' };
      }
      return { text: runningText[stage], tone: 'active' };
    case 'done':
      if (stage === 'generate') return { text: `${job.segments.length}개 구간 완료`, tone: 'done' };
      return { text: '완료 · 저장됨', tone: 'done' };
    case 'failed':
      if (stage === 'generate') {
        const failed = job.segments.filter((s) => s.status === 'failed').length;
        return { text: `${failed}개 구간 실패`, tone: 'failed' };
      }
      return { text: state.error ?? '실패', tone: 'failed' };
    default:
      return { text: canRunStage(job, stage) ? '실행할 수 있습니다' : '앞 단계를 기다립니다', tone: 'idle' };
  }
}

export function StageNode({ data }: NodeProps & { data: StageNodeData }) {
  const { stage, job } = data;
  const { text, tone } = summarize(stage, job);
  const state = job?.stages[stage];
  const failedSegments = stage === 'generate' ? (job?.segments ?? []).filter((s) => s.status === 'failed') : [];
  const showRetries = state?.status === 'failed' && failedSegments.length > 0 && data.onRetrySegment;

  return (
    <NodeCard title={titles[stage]} width={200} tone={tone} input output>
      <div
        className="text-[13px] leading-snug"
        style={{ color: tone === 'idle' ? 'var(--ink-muted)' : 'var(--ink)' }}
      >
        {text}
      </div>

      {state?.status === 'done' && data.outputUrl && (
        <div className="mt-2 aspect-video w-full overflow-hidden rounded-md bg-[var(--well)]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={data.outputUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        </div>
      )}

      {showRetries ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {failedSegments.map((s) => (
            <button
              key={s.index}
              type="button"
              onClick={() => data.onRetrySegment?.(s.index)}
              className="rounded-md border border-[var(--danger)] px-2 py-1 text-[12px] text-[var(--ink)] hover:bg-[var(--danger)] hover:text-black"
            >
              구간 {s.index + 1} 다시
            </button>
          ))}
        </div>
      ) : data.onRun ? (
        <button
          type="button"
          onClick={data.onRun}
          className="mt-2 w-full rounded-md border border-[var(--card-border-strong)] py-1.5 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--media)] hover:text-[var(--media)]"
        >
          {state?.status === 'failed' ? '이 단계 다시 실행' : '이 단계만 실행'}
        </button>
      ) : null}
    </NodeCard>
  );
}
