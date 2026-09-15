'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

export type ResultNodeData = { job: Job | null; resultUrl: string | null };

export function ResultNode({ data }: NodeProps & { data: ResultNodeData }) {
  const isDone = data.job?.status === 'done' && Boolean(data.resultUrl);

  return (
    <div className="w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100 shadow-lg">
      <Handle type="target" position={Position.Left} />
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">결과</div>
      {isDone ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={data.resultUrl!} controls className="w-full rounded" />
          <a href={data.resultUrl!} download className="block text-center text-sm text-emerald-400 underline">
            다운로드
          </a>
        </div>
      ) : (
        <div className="text-sm text-slate-500">아직 결과 없음</div>
      )}
    </div>
  );
}
