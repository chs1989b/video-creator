import type { Job } from './workerApi';
import { inputEditable } from './previewRules';

// The canvas is assembled from required cards (source video, person, preview,
// generation, merge, result) and optional ones the user can add or remove.
// Order is fixed by rule: removing a stage reconnects its neighbours, so the
// worker still runs its stages in STAGE_ORDER and skips the ones left empty.

export type OptionalNode = 'product' | 'restyle' | 'edit' | 'voiceover';
export const OPTIONAL_NODES: OptionalNode[] = ['product', 'restyle', 'edit', 'voiceover'];

export const OPTIONAL_LABELS: Record<OptionalNode, string> = {
  product: '제품 사진',
  restyle: '의상·배경 교체',
  edit: '최종 보정',
  voiceover: '나레이션',
};

/** Canvas cards that belong to each optional node (a stage brings its prompt card). */
export const NODE_IDS: Record<OptionalNode, string[]> = {
  product: ['product'],
  restyle: ['restyle-prompt', 'restyle'],
  edit: ['edit-prompt', 'edit'],
  voiceover: ['script', 'voiceover'],
};

const STAGE_CHAIN: Array<Exclude<OptionalNode, 'product'>> = ['restyle', 'edit', 'voiceover'];
const PROMPT_CARD = { restyle: 'restyle-prompt', edit: 'edit-prompt', voiceover: 'script' } as const;

export type PipelineEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'media' | 'text' | 'flow';
  /** The worker stage this edge feeds, to animate it while that stage runs. */
  stage?: 'generate' | 'merge' | 'restyle' | 'edit' | 'voiceover';
};

export function hiddenNodeIds(present: Set<OptionalNode>): Set<string> {
  return new Set(OPTIONAL_NODES.filter((n) => !present.has(n)).flatMap((n) => NODE_IDS[n]));
}

export function pipelineEdges(present: Set<OptionalNode>): PipelineEdge[] {
  const edges: PipelineEdge[] = [
    { id: 'video-preview', source: 'video', target: 'preview', kind: 'media' },
    { id: 'person-preview', source: 'person', target: 'preview', kind: 'media' },
  ];
  if (present.has('product')) edges.push({ id: 'product-preview', source: 'product', target: 'preview', kind: 'media' });
  edges.push(
    { id: 'preview-generate', source: 'preview', target: 'generate', kind: 'flow', stage: 'generate' },
    { id: 'generate-merge', source: 'generate', target: 'merge', kind: 'flow', stage: 'merge' },
  );

  let previous = 'merge';
  for (const stage of STAGE_CHAIN) {
    if (!present.has(stage)) continue;
    edges.push({ id: `${previous}-${stage}`, source: previous, target: stage, kind: 'flow', stage });
    edges.push({ id: `${PROMPT_CARD[stage]}-${stage}`, source: PROMPT_CARD[stage], target: stage, kind: 'text', stage });
    previous = stage;
  }
  edges.push({ id: `${previous}-result`, source: previous, target: 'result', kind: 'flow' });
  return edges;
}

/**
 * Can this optional node be added or removed now? Before a job exists, always.
 * The product photo is part of the job, so after that it stays as it is.
 * A stage follows the same rule as its prompt: after approval, until it runs.
 */
export function canToggle(job: Job | null, node: OptionalNode): boolean {
  if (!job) return true;
  if (node === 'product') return false;
  return inputEditable(job, node);
}

/** Which optional nodes a saved job shows: the ones it uses, plus stages that can still be added. */
export function presentFromJob(job: Job): Set<OptionalNode> {
  const present = new Set<OptionalNode>();
  if (job.productImagePaths.length > 0) present.add('product');
  for (const stage of STAGE_CHAIN) {
    if (job.stages[stage]?.status !== 'skipped' || canToggle(job, stage)) present.add(stage);
  }
  return present;
}

/** The optional node a canvas card belongs to, or null for a required card. */
export function optionalNodeOf(cardId: string): OptionalNode | null {
  return OPTIONAL_NODES.find((n) => NODE_IDS[n].includes(cardId)) ?? null;
}

type Point = { x: number; y: number };
const PROMPT_ABOVE = 260;

/** Where a node's cards go when it is dropped from the palette: the stage at the drop point, its prompt card above. */
export function dropPlacement(node: OptionalNode, at: Point): Record<string, Point> {
  if (node === 'product') return { product: at };
  return { [node]: at, [PROMPT_CARD[node]]: { x: at.x, y: at.y - PROMPT_ABOVE } };
}

/** Why a node cannot be attached or detached right now, or null when it can. */
export function lockReason(job: Job | null, node: OptionalNode, present: Set<OptionalNode>): string | null {
  if (canToggle(job, node) || !job) return null;
  if (node === 'product') return '작업을 만든 뒤에는 바꿀 수 없음';
  if (!job.previewRequired) return '예전 방식 작업이라 바꿀 수 없음';
  if (!job.approvedAttemptId) return '미리보기를 승인한 뒤에 바꿀 수 있음';
  const status = job.stages[node]?.status;
  if (job.status === 'running' || status === 'running') return '실행 중에는 바꿀 수 없음';
  if (status === 'done') return '이미 완료된 단계';
  if (status === 'skipped') return present.has(node) ? '이 작업에서는 건너뛴 단계 (입력이 비어 있었음)' : '이 작업에서는 뺀 단계';
  return '뒤 단계가 이미 실행되어 바꿀 수 없음';
}
