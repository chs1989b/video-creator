'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export type CharacterInputNodeData = {
  fileName: string | null;
  onFileChange: (file: File | null) => void;
  disabled: boolean;
};

export function CharacterInputNode({ data }: NodeProps & { data: CharacterInputNodeData }) {
  return (
    <div className="w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100 shadow-lg">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">캐릭터 입력</div>
      <input
        type="file"
        accept="image/*"
        disabled={data.disabled}
        onChange={(e) => data.onFileChange(e.target.files?.[0] ?? null)}
        className="w-full text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-slate-100 disabled:opacity-50"
      />
      {data.fileName && <div className="mt-1 truncate text-xs text-slate-500">{data.fileName}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
