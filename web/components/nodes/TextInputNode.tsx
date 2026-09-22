'use client';

import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';

export type TextInputNodeData = {
  title: string;
  placeholder: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
};

/** A note card: used for the narration script and the final edit prompt. */
export function TextInputNode({ data }: NodeProps & { data: TextInputNodeData }) {
  return (
    <NodeCard title={data.title} width={200} output outputColor="var(--text-edge)">
      <textarea
        rows={5}
        placeholder={data.placeholder}
        value={data.value}
        disabled={data.disabled}
        onChange={(e) => data.onChange(e.target.value)}
        className="w-full resize-none rounded-md border border-[var(--card-border)] bg-black px-2 py-1.5 text-[12px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-faint)] disabled:opacity-50"
      />
      <div className="mt-1 text-[11px] text-[var(--ink-faint)]">{data.hint}</div>
    </NodeCard>
  );
}
