'use client';

import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';

export type VideoInputNodeData = {
  url: string;
  onUrlChange: (url: string) => void;
  disabled: boolean;
};

const isDirectVideo = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

export function VideoInputNode({ data }: NodeProps & { data: VideoInputNodeData }) {
  return (
    <NodeCard title="원본 영상" width={220} output outputColor="var(--media)">
      <div className="mb-2 aspect-video w-full overflow-hidden rounded-md bg-black">
        {isDirectVideo(data.url) ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={data.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--ink-faint)]">
            {data.url ? '미리보기는 mp4 직링크만' : '영상 링크를 붙여넣으세요'}
          </div>
        )}
      </div>
      <input
        type="text"
        placeholder="https://…/video.mp4"
        value={data.url}
        disabled={data.disabled}
        onChange={(e) => data.onUrlChange(e.target.value)}
        className="w-full rounded-md border border-[var(--card-border)] bg-black px-2 py-1 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] disabled:opacity-50"
      />
    </NodeCard>
  );
}
