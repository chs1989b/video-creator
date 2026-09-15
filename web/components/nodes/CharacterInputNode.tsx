'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export type CharacterInputNodeData = {
  fileName: string | null;
  onFileChange: (file: File | null) => void;
  disabled: boolean;
};

export function CharacterInputNode({ data }: NodeProps & { data: CharacterInputNodeData }) {
  return (
    <div className="w-[280px] rounded-lg border border-[#42424D] bg-[#16161A] p-3 text-[#FAFAFA]">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">캐릭터 입력</div>
      <input
        type="file"
        accept="image/*"
        disabled={data.disabled}
        onChange={(e) => data.onFileChange(e.target.files?.[0] ?? null)}
        className="w-full text-xs text-[#72727A] file:mr-2 file:rounded file:border-0 file:bg-[#2A2A30] file:px-2 file:py-1 file:text-[#FAFAFA] disabled:opacity-50"
      />
      {data.fileName && <div className="mt-1 truncate text-xs text-[#595966]">{data.fileName}</div>}
      <Handle type="source" position={Position.Right} style={{ background: '#3BC48D', borderColor: '#3BC48D', width: 10, height: 10 }} />
    </div>
  );
}
