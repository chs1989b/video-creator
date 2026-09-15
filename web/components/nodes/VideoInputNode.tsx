'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export type VideoInputNodeData = {
  url: string;
  onUrlChange: (url: string) => void;
  disabled: boolean;
};

export function VideoInputNode({ data }: NodeProps & { data: VideoInputNodeData }) {
  return (
    <div className="w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100 shadow-lg">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">영상 입력</div>
      <input
        type="text"
        placeholder="https://youtube.com/..."
        value={data.url}
        disabled={data.disabled}
        onChange={(e) => data.onUrlChange(e.target.value)}
        className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
