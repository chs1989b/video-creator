'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export type ScriptInputNodeData = {
  script: string;
  onScriptChange: (script: string) => void;
  disabled: boolean;
};

export function ScriptInputNode({ data }: NodeProps & { data: ScriptInputNodeData }) {
  return (
    <div className="w-[280px] rounded-lg border border-[#42424D] bg-[#16161A] p-3 text-[#FAFAFA]">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#72727A]">대본 입력 (선택)</div>
      <textarea
        rows={4}
        placeholder="영상에 입힐 나레이션을 입력하세요"
        value={data.script}
        disabled={data.disabled}
        onChange={(e) => data.onScriptChange(e.target.value)}
        className="w-full resize-none rounded border border-[#42424D] bg-[#0A0A0A] px-2 py-1 text-sm text-[#FAFAFA] placeholder:text-[#595966] disabled:opacity-50"
      />
      <div className="mt-1 text-xs text-[#595966]">비우면 음성 없이 영상만 만듭니다</div>
      <Handle type="source" position={Position.Right} style={{ background: '#4FA3E0', borderColor: '#4FA3E0', width: 10, height: 10 }} />
    </div>
  );
}
