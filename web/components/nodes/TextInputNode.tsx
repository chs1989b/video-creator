'use client';

import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';
import { PromptRefiner } from '../PromptRefiner';
import { VoicePicker, type VoicePickerProps } from '../VoicePicker';

export type TextInputNodeData = {
  title: string;
  placeholder: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onRemove?: (() => void) | null;
  /** Shows "프롬프트 다듬기" for prompt cards (not for the narration script). */
  refineStage?: 'restyle' | 'edit';
  /** The narration script card also picks the voice that reads it. */
  voice?: Omit<VoicePickerProps, 'script'> | null;
};

/** A note card: used for the narration script and the final edit prompt. */
export function TextInputNode({ data }: NodeProps & { data: TextInputNodeData }) {
  return (
    <NodeCard title={data.title} width={data.refineStage || data.voice ? 240 : 200} output outputColor="var(--text-edge)" onRemove={data.onRemove}>
      <textarea
        rows={5}
        placeholder={data.placeholder}
        value={data.value}
        disabled={data.disabled}
        onChange={(e) => data.onChange(e.target.value)}
        className="w-full resize-none rounded-md border border-[var(--card-border)] bg-[var(--well)] px-2 py-1.5 text-[13px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-faint)] disabled:opacity-50"
      />
      {data.refineStage && (
        <PromptRefiner stage={data.refineStage} request={data.value} onApply={data.onChange} disabled={data.disabled} />
      )}
      {data.voice && <VoicePicker {...data.voice} script={data.value} />}
      <div className="mt-1.5 text-[12px] text-[var(--ink-muted)]">{data.hint}</div>
    </NodeCard>
  );
}
