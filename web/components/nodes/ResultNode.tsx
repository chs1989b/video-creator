'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Job } from '../../lib/workerApi';

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

  return (
    <div className="w-[280px] rounded-lg border border-[#42424D] bg-[#16161A] p-3 text-[#FAFAFA]">
      <Handle type="target" position={Position.Left} style={{ background: '#72727A', borderColor: '#72727A', width: 10, height: 10 }} />
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">결과</div>
      {isDone ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={data.resultUrl!} controls className="w-full rounded" />
          <button
            type="button"
            onClick={() => handleDownload(data.resultUrl!, data.job!.id)}
            className="block w-full rounded-full border border-[#42424D] bg-[#2A2A30] py-1.5 text-center text-xs font-medium text-[#FAFAFA] transition-colors hover:border-[#3BC48D] hover:text-[#3BC48D]"
          >
            다운로드
          </button>
        </div>
      ) : (
        <div className="text-sm text-[#595966]">아직 결과 없음</div>
      )}
    </div>
  );
}
