'use client';

import { useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeCard } from './NodeCard';
import { SOURCE_EXTENSIONS, formatBytes } from '../../lib/sourceInput';

export type VideoInputNodeData = {
  url: string;
  onUrlChange: (url: string) => void;
  /** An uploaded source video, used instead of the link. */
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Original name of the file a saved job was made from (the file itself is on the worker). */
  savedName: string | null;
  disabled: boolean;
};

type Mode = 'link' | 'file';

const isDirectVideo = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);
const ACCEPT = SOURCE_EXTENSIONS.map((e) => `.${e}`).join(',');

/** The source video: a link, or a file of the user's own (exactly one). */
export function VideoInputNode({ data }: NodeProps & { data: VideoInputNodeData }) {
  const [mode, setMode] = useState<Mode>(data.file || data.savedName ? 'file' : 'link');
  // A saved job decides the mode: show the file name for uploaded sources.
  useEffect(() => {
    if (data.savedName) setMode('file');
  }, [data.savedName]);

  const fileUrl = useMemo(() => (data.file ? URL.createObjectURL(data.file) : null), [data.file]);
  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  // Switching clears the other input, so only one source is ever sent.
  const switchTo = (next: Mode) => {
    if (next === mode || data.disabled) return;
    if (next === 'file') data.onUrlChange('');
    else data.onFileChange(null);
    setMode(next);
  };

  const previewSrc = mode === 'file' ? fileUrl : isDirectVideo(data.url) ? data.url : null;
  const emptyText = mode === 'file'
    ? data.savedName ? '업로드한 파일로 만든 작업입니다' : '내 영상 파일을 고르세요'
    : data.url ? '미리보기는 mp4 직링크만' : '영상 링크를 붙여넣으세요';

  return (
    <NodeCard title="원본 영상" width={220} output outputColor="var(--media)">
      <div role="tablist" aria-label="원본 영상 넣는 방법" className="nodrag mb-2 grid grid-cols-2 gap-1 rounded-md bg-[var(--well)] p-0.5 text-[12px]">
        {(['link', 'file'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={data.disabled && mode !== m}
            onClick={() => switchTo(m)}
            className={`rounded py-1 transition-colors ${mode === m ? 'bg-[var(--card)] font-medium text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'} disabled:opacity-40`}
          >
            {m === 'link' ? '링크' : '파일'}
          </button>
        ))}
      </div>

      <div className="mb-2 aspect-video w-full overflow-hidden rounded-md bg-[var(--well)]">
        {previewSrc ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={previewSrc} src={previewSrc} muted playsInline controls={mode === 'file'} preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-[12px] text-[var(--ink-muted)]">{emptyText}</div>
        )}
      </div>

      {mode === 'link' ? (
        <input
          type="text"
          placeholder="https://…/video.mp4"
          value={data.url}
          disabled={data.disabled}
          onChange={(e) => data.onUrlChange(e.target.value)}
          className="w-full rounded-md border border-[var(--card-border)] bg-[var(--well)] px-2 py-1.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] disabled:opacity-50"
        />
      ) : (
        <label className={`nodrag block ${data.disabled ? 'cursor-default' : 'cursor-pointer'}`}>
          <input
            type="file"
            accept={ACCEPT}
            disabled={data.disabled}
            onChange={(e) => data.onFileChange(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <span className="block w-full truncate rounded-md border border-dashed border-[var(--card-border-strong)] px-2 py-1.5 text-[12.5px] text-[var(--ink)]">
            {data.file ? `${data.file.name} · ${formatBytes(data.file.size)}` : data.savedName ?? '파일 선택 (mp4·mov·m4v·webm, 200MB 이하)'}
          </span>
        </label>
      )}
      <div className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-muted)]">사용 권한이 있는 영상만 올려 주세요.</div>
    </NodeCard>
  );
}
