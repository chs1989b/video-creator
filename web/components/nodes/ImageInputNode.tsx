'use client';

import { useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';

export type ImageInputNodeData = {
  title: string;
  hint: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled: boolean;
  onRemove?: (() => void) | null;
  /** The photo already saved with the loaded job, shown until a new file is picked. */
  savedUrl?: string | null;
};

/** One card for both the person and the product: an image well with a picker under it. */
export function ImageInputNode({ data }: NodeProps & { data: ImageInputNodeData }) {
  const previewUrl = useMemo(() => (data.file ? URL.createObjectURL(data.file) : null), [data.file]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  const [savedMissing, setSavedMissing] = useState(false);
  useEffect(() => setSavedMissing(false), [data.savedUrl]);
  const savedUrl = data.savedUrl && !savedMissing ? data.savedUrl : null;
  const shownUrl = previewUrl ?? savedUrl;

  return (
    <NodeCard title={data.title} width={180} output outputColor="var(--media)" onRemove={data.onRemove}>
      <label className="block cursor-pointer">
        <div className="mb-2 aspect-square w-full overflow-hidden rounded-md bg-[var(--well)]">
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={shownUrl === savedUrl ? () => setSavedMissing(true) : undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[12.5px] leading-snug text-[var(--ink-muted)]">
              {data.hint}
            </div>
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          disabled={data.disabled}
          onChange={(e) => data.onFileChange(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <span className="block truncate text-[12px] text-[var(--ink-muted)]">
          {data.file ? data.file.name : savedUrl ? '이 작업에 저장된 사진' : '이미지 선택'}
        </span>
      </label>
    </NodeCard>
  );
}
