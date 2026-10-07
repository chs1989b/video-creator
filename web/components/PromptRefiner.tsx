'use client';

import { useState } from 'react';
import type { RefineResult, RefineStage } from '../lib/promptBuilder';
import { requestRefine } from '../lib/promptApi';

type Props = {
  stage: RefineStage;
  /** The rough request: what the user typed in the box this refiner belongs to. */
  request: string;
  rejectReasons?: string[];
  onApply: (prompt: string) => void;
  disabled?: boolean;
};

/**
 * "다듬기": turns a rough (often Korean) request into an English prompt and
 * shows it with a Korean explanation. Nothing changes until the user applies it.
 */
export function PromptRefiner({ stage, request, rejectReasons = [], onApply, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<RefineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = !request.trim() && !(stage === 'face' && rejectReasons.length > 0);

  const refine = async () => {
    setLoading(true);
    setError(null);
    try {
      setSuggestion(await requestRefine({ stage, request, rejectReasons }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="nodrag mt-1.5">
      {!suggestion && (
        <button
          type="button"
          onClick={refine}
          disabled={disabled || loading || empty}
          title={empty ? '먼저 바꾸고 싶은 점을 적어 주세요' : '영어 프롬프트로 다듬어 제안합니다'}
          className="w-full rounded-md border border-dashed border-[var(--text-edge)] py-1 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--well)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? '다듬는 중…' : '✨ 프롬프트 다듬기'}
        </button>
      )}
      {error && <div className="mt-1 text-[11.5px] text-[var(--danger)]">{error}</div>}

      {suggestion && (
        <div className="rounded-md border border-[var(--text-edge)] bg-[var(--well)] p-2 text-[12px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-[var(--ink)]">제안</span>
            <span className="rounded-full border border-[var(--card-border-strong)] px-1.5 text-[10.5px] text-[var(--ink-muted)]">
              {suggestion.source === 'claude' ? 'Claude' : '간단 변환'}
            </span>
          </div>
          <p className="select-text break-words font-mono text-[11.5px] leading-snug text-[var(--ink)]">{suggestion.prompt}</p>
          <p className="mt-1.5 leading-snug text-[var(--ink-muted)]">{suggestion.explanation_ko}</p>
          {suggestion.notice && <p className="mt-1 leading-snug text-[var(--danger)]">{suggestion.notice}</p>}
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => { onApply(suggestion.prompt); setSuggestion(null); }}
              className="flex-1 rounded-md border border-[var(--media)] py-1 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--media)] hover:text-black"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="flex-1 rounded-md border border-[var(--card-border-strong)] py-1 text-[12px] text-[var(--ink)]"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
