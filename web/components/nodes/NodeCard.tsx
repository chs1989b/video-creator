'use client';

import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';

export type Tone = 'idle' | 'active' | 'done' | 'failed';

export const toneColor: Record<Tone, string> = {
  idle: 'var(--ink-faint)',
  active: 'var(--text-edge)',
  done: 'var(--media)',
  failed: 'var(--danger)',
};

type Props = {
  title: string;
  width?: number;
  tone?: Tone;
  /** Left handle: this card consumes something. */
  input?: boolean;
  /** Right handle: this card produces something. */
  output?: boolean;
  outputColor?: string;
  children: ReactNode;
};

/**
 * Shared shell for every card on the canvas: a thin dark frame, a quiet
 * one-line title, and colored handles that tell you what flows in and out.
 */
export function NodeCard({
  title,
  width = 200,
  tone = 'idle',
  input = false,
  output = false,
  outputColor,
  children,
}: Props) {
  const accent = toneColor[tone];
  return (
    <div
      style={{ width, borderColor: tone === 'idle' ? 'var(--card-border)' : accent }}
      className="relative rounded-[10px] border bg-[var(--card)] shadow-[0_10px_34px_rgba(0,0,0,0.7)]"
    >
      {input && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: 'var(--ink-muted)' }}
        />
      )}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[12.5px] font-medium text-[var(--ink)]">{title}</span>
        {tone !== 'idle' && (
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: accent }}
          />
        )}
      </div>
      <div className="px-3 pb-3">{children}</div>
      {output && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: outputColor ?? accent }}
        />
      )}
    </div>
  );
}
