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
      className="relative rounded-[10px] border bg-[var(--card)] shadow-[0_8px_30px_rgba(0,0,0,0.55)]"
    >
      {input && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: 'var(--ink-faint)' }}
        />
      )}
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <span className="text-[11px] text-[var(--ink-muted)]">{title}</span>
        {tone !== 'idle' && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
      </div>
      <div className="px-2.5 pb-2.5">{children}</div>
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
