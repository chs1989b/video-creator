'use client';

import { forwardRef } from 'react';
import { OPTIONAL_LABELS, OPTIONAL_NODES, type OptionalNode } from '../lib/pipelineGraph';

/** dataTransfer type for a palette tile dragged onto the canvas. */
export const PALETTE_MIME = 'application/x-pipeline-node';

const REQUIRED = ['원본 영상', '바꿀 인물', '미리보기 (5초)', '나머지 구간 생성', '구간 이어붙이기', '완성 영상'];

const DESCRIPTIONS: Record<OptionalNode, { what: string; cost: string }> = {
  product: { what: '손에 든 제품까지 교체', cost: '추가 크레딧 0 (인물 교체와 한 번에)' },
  restyle: { what: '옷·배경을 프롬프트로 다시 그림', cost: '10초당 약 15크레딧' },
  edit: { what: '조명·톤 등 마무리 보정', cost: '10초당 약 15크레딧' },
  voiceover: { what: '대본을 영어 음성으로 얹음', cost: '약 0.45크레딧' },
};

type Props = {
  present: Set<OptionalNode>;
  /** Why a node cannot be attached or detached right now, or null when it can. */
  lockReason: (node: OptionalNode) => string | null;
  onAttach: (node: OptionalNode) => void;
  onDetach: (node: OptionalNode) => void;
  /** A canvas card is being dragged over the palette: dropping it detaches it. */
  dropActive: boolean;
};

/**
 * The parts box: required cards are listed for orientation, optional ones are
 * tiles that can be dragged onto the canvas (attach) or dragged back (detach).
 */
export const NodePalette = forwardRef<HTMLElement, Props>(function NodePalette(
  { present, lockReason, onAttach, onDetach, dropActive },
  ref,
) {
  return (
    <aside
      ref={ref}
      aria-label="노드 팔레트"
      className={`z-20 flex h-full w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r bg-[var(--card)] px-3 py-4 ${dropActive ? 'border-[var(--danger)] bg-[var(--well)]' : 'border-[var(--card-border)]'}`}
    >
      <div>
        <div className="text-[13px] font-medium text-[var(--ink)]">노드</div>
        <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-muted)]">
          선택 노드를 캔버스로 끌어다 놓으면 붙고, 캔버스의 카드를 여기로 끌어오면 떨어집니다.
        </p>
      </div>

      {dropActive && (
        <div className="rounded-md border border-dashed border-[var(--danger)] px-2 py-3 text-center text-[12px] text-[var(--ink)]">
          여기에 놓으면 이 노드를 뗍니다
        </div>
      )}

      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">선택 노드</div>
        <ul className="space-y-1.5">
          {OPTIONAL_NODES.map((node) => {
            const attached = present.has(node);
            const reason = lockReason(node);
            return (
              <li
                key={node}
                draggable={!attached && !reason}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_MIME, node);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                title={reason ?? undefined}
                className={`rounded-md border px-2.5 py-2 ${
                  attached
                    ? 'border-[var(--media)] bg-[var(--card)]'
                    : 'border-dashed border-[var(--card-border-strong)] bg-[var(--well)]'
                } ${!attached && !reason ? 'cursor-grab active:cursor-grabbing' : ''} ${reason ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-[var(--ink)]">{OPTIONAL_LABELS[node]}</span>
                  <button
                    type="button"
                    disabled={Boolean(reason)}
                    onClick={() => (attached ? onDetach(node) : onAttach(node))}
                    className="rounded-full border border-[var(--card-border-strong)] px-2 py-0.5 text-[11px] text-[var(--ink)] hover:border-[var(--media)] disabled:cursor-not-allowed"
                  >
                    {attached ? '떼기' : '붙이기'}
                  </button>
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-muted)]">{DESCRIPTIONS[node].what}</div>
                <div className="text-[11px] text-[var(--ink-faint)]">{DESCRIPTIONS[node].cost}</div>
                <div className="mt-1 text-[11px]" style={{ color: attached ? 'var(--media)' : 'var(--ink-faint)' }}>
                  {reason ?? (attached ? '● 캔버스에 붙어 있음' : '○ 끌어서 캔버스에 놓기')}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">필수 노드 (항상 붙어 있음)</div>
        <ul className="space-y-1">
          {REQUIRED.map((label) => (
            <li key={label} className="rounded-md bg-[var(--well)] px-2.5 py-1.5 text-[12px] text-[var(--ink-muted)]">{label}</li>
          ))}
        </ul>
      </section>

      <p className="mt-auto text-[11px] leading-snug text-[var(--ink-faint)]">
        연결 순서는 자동으로 맞춰집니다: 이어붙이기 → 의상·배경 → 최종 보정 → 나레이션 → 완성.
      </p>
    </aside>
  );
});
