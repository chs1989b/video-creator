'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export type VideoInputNodeData = {
  url: string;
  onUrlChange: (url: string) => void;
  disabled: boolean;
};

export function VideoInputNode({ data }: NodeProps & { data: VideoInputNodeData }) {
  return (
    <div className="w-[280px] rounded-lg border border-[#42424D] bg-[#16161A] p-3 text-[#FAFAFA]">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">영상 입력</div>
      <input
        type="text"
        placeholder="https://youtube.com/..."
        value={data.url}
        disabled={data.disabled}
        onChange={(e) => data.onUrlChange(e.target.value)}
        className="w-full rounded border border-[#42424D] bg-[#0A0A0A] px-2 py-1 text-sm text-[#FAFAFA] placeholder:text-[#595966] disabled:opacity-50"
      />
      <Handle type="source" position={Position.Right} style={{ background: '#892DBE', borderColor: '#892DBE', width: 10, height: 10 }} />
    </div>
  );
}
