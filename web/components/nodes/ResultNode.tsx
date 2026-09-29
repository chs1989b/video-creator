'use client';

import type { NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';
import { NodeCard } from './NodeCard';

export type ResultNodeData = { job: Job | null; resultUrl: string | null };

async function handleDownload(url: string, jobId: string) {
  const res = await fetch(url);
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${jobId}.mp4`;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

export function ResultNode({ data }: NodeProps & { data: ResultNodeData }) {
  const isDone = data.job?.status === 'done' && Boolean(data.resultUrl);
  const tone = isDone ? 'done' : data.job?.status === 'failed' ? 'failed' : 'idle';

  return (
    <NodeCard title="완성 영상" width={260} tone={tone} input>
      <div className="aspect-video w-full overflow-hidden rounded-md bg-[var(--well)]">
        {isDone ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={data.resultUrl!} controls className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[12.5px] text-[var(--ink-muted)]">
            {data.job?.status === 'failed' ? '만들지 못했습니다' : '아직 없음'}
          </div>
        )}
      </div>
      {isDone && (
        <button
          type="button"
          onClick={() => handleDownload(data.resultUrl!, data.job!.id)}
          className="mt-2 w-full rounded-md border border-[var(--card-border-strong)] py-1.5 text-[13px] text-[var(--ink)] transition-colors hover:border-[var(--media)] hover:text-[var(--media)]"
        >
          mp4 저장
        </button>
      )}
    </NodeCard>
  );
}
