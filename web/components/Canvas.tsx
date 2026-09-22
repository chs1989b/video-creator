'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { VideoInputNode, type VideoInputNodeData } from './nodes/VideoInputNode';
import { ImageInputNode, type ImageInputNodeData } from './nodes/ImageInputNode';
import { TextInputNode, type TextInputNodeData } from './nodes/TextInputNode';
import { StageNode, type StageNodeData } from './nodes/StageNode';
import { ResultNode, type ResultNodeData } from './nodes/ResultNode';
import { createJob, getJob, resultUrl, type Job } from '../lib/workerApi';

const nodeTypes = {
  videoInput: VideoInputNode,
  imageInput: ImageInputNode,
  textInput: TextInputNode,
  stage: StageNode,
  result: ResultNode,
};

type AnyNodeData =
  | VideoInputNodeData
  | ImageInputNodeData
  | TextInputNodeData
  | StageNodeData
  | ResultNodeData;

const POLL_INTERVAL_MS = 2000;

const MEDIA = 'var(--media)';
const TEXT = 'var(--text-edge)';
const QUIET = 'var(--ink-faint)';

// Positions sketch the pipeline left to right; inputs hang off the stage they
// feed so the picture reads as "what goes into what".
function buildInitialNodes(): Node<AnyNodeData>[] {
  const noop = () => {};
  return [
    { id: 'video', type: 'videoInput', position: { x: 0, y: 40 }, data: { url: '', onUrlChange: noop, disabled: false } },
    { id: 'person', type: 'imageInput', position: { x: 20, y: 300 }, data: { title: '바꿀 인물', hint: '인물 사진', file: null, onFileChange: noop, disabled: false } },
    { id: 'product', type: 'imageInput', position: { x: 20, y: 560 }, data: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: null, onFileChange: noop, disabled: false } },
    { id: 'generate', type: 'stage', position: { x: 340, y: 300 }, data: { stage: 'generate', job: null } },
    { id: 'merge', type: 'stage', position: { x: 620, y: 300 }, data: { stage: 'merge', job: null } },
    { id: 'edit-prompt', type: 'textInput', position: { x: 620, y: 40 }, data: { title: '보정 프롬프트', placeholder: '예: 조명을 더 따뜻하게, 배경은 그대로', hint: '비우면 보정 없이 넘어갑니다', value: '', onChange: noop, disabled: false } },
    { id: 'edit', type: 'stage', position: { x: 900, y: 300 }, data: { stage: 'edit', job: null } },
    { id: 'script', type: 'textInput', position: { x: 900, y: 560 }, data: { title: '나레이션 대본', placeholder: '영상에 얹을 말을 적어주세요', hint: '비우면 음성 없이 만듭니다', value: '', onChange: noop, disabled: false } },
    { id: 'voiceover', type: 'stage', position: { x: 1180, y: 300 }, data: { stage: 'voiceover', job: null } },
    { id: 'result', type: 'result', position: { x: 1460, y: 270 }, data: { job: null, resultUrl: null } },
  ];
}

type EdgeSpec = { id: string; source: string; target: string; color: string; stage?: Job['status'] };

const edgeSpecs: EdgeSpec[] = [
  { id: 'video-generate', source: 'video', target: 'generate', color: MEDIA, stage: 'generating' },
  { id: 'person-generate', source: 'person', target: 'generate', color: MEDIA, stage: 'generating' },
  { id: 'product-generate', source: 'product', target: 'generate', color: MEDIA, stage: 'generating' },
  { id: 'generate-merge', source: 'generate', target: 'merge', color: QUIET, stage: 'merging' },
  { id: 'merge-edit', source: 'merge', target: 'edit', color: QUIET, stage: 'editing' },
  { id: 'prompt-edit', source: 'edit-prompt', target: 'edit', color: TEXT, stage: 'editing' },
  { id: 'edit-voiceover', source: 'edit', target: 'voiceover', color: QUIET, stage: 'voiceover' },
  { id: 'script-voiceover', source: 'script', target: 'voiceover', color: TEXT, stage: 'voiceover' },
  { id: 'voiceover-result', source: 'voiceover', target: 'result', color: QUIET },
];

function buildEdges(job: Job | null): Edge[] {
  return edgeSpecs.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: e.color },
    className: job && e.stage && job.status === e.stage ? 'is-running' : undefined,
  }));
}

export function Canvas() {
  const [nodes, , onNodesChange] = useNodesState<Node<AnyNodeData>>(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges(null));

  const [url, setUrl] = useState('');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [script, setScript] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = job !== null && job.status !== 'done' && job.status !== 'failed';
  const locked = isRunning || isSubmitting;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // Edge animation follows the job: only the edges feeding the running stage move.
  useEffect(() => {
    setEdges(buildEdges(job));
  }, [job, setEdges]);

  const handleRun = useCallback(async () => {
    if (!url || !personFile) {
      setErrorMessage('원본 영상 링크와 바꿀 인물 사진이 필요합니다.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const created = await createJob({
        youtubeUrl: url,
        characterImage: personFile,
        productImage: productFile,
        script,
        editPrompt,
      });
      setJob(created);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const updated = await getJob(created.id);
          setJob(updated);
          if (updated.status === 'done' || updated.status === 'failed') {
            stopPolling();
          }
        } catch {
          // 폴링 중 일시적 네트워크 오류는 다음 폴링에서 자연히 회복된다.
        }
      }, POLL_INTERVAL_MS);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '작업을 시작하지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }, [url, personFile, productFile, script, editPrompt, stopPolling]);

  const dataById = useMemo<Record<string, AnyNodeData>>(
    () => ({
      video: { url, onUrlChange: setUrl, disabled: locked },
      person: { title: '바꿀 인물', hint: '인물 사진', file: personFile, onFileChange: setPersonFile, disabled: locked },
      product: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: productFile, onFileChange: setProductFile, disabled: locked },
      'edit-prompt': {
        title: '보정 프롬프트',
        placeholder: '예: 조명을 더 따뜻하게, 배경은 그대로',
        hint: '비우면 보정 없이 넘어갑니다',
        value: editPrompt,
        onChange: setEditPrompt,
        disabled: locked,
      },
      script: {
        title: '나레이션 대본',
        placeholder: '영상에 얹을 말을 적어주세요',
        hint: '비우면 음성 없이 만듭니다',
        value: script,
        onChange: setScript,
        disabled: locked,
      },
      generate: { stage: 'generate', job },
      merge: { stage: 'merge', job },
      edit: { stage: 'edit', job },
      voiceover: { stage: 'voiceover', job },
      result: { job, resultUrl: job ? resultUrl(job.id) : null },
    }),
    [url, personFile, productFile, editPrompt, script, job, locked],
  );

  const renderNodes = useMemo(
    () => nodes.map((node) => ({ ...node, data: dataById[node.id] ?? node.data })),
    [nodes, dataById],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const runLabel = isSubmitting ? '보내는 중' : isRunning ? '만드는 중' : '영상 만들기';

  return (
    <div className="relative h-screen w-screen bg-[var(--canvas)]">
      <div className="pointer-events-none absolute left-5 top-4 z-10 text-[12px] text-[var(--ink-muted)]">
        얼굴·제품 교체 워크플로
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md border border-[var(--danger)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--ink)]"
        >
          {errorMessage}
        </div>
      )}

      <button
        type="button"
        onClick={handleRun}
        disabled={locked}
        className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-[var(--card-border-strong)] bg-[rgba(18,18,20,0.85)] px-6 py-3 text-[14px] font-medium tracking-wide text-[var(--ink)] shadow-[0_12px_40px_rgba(0,0,0,0.7)] backdrop-blur transition-colors hover:border-[var(--media)] disabled:cursor-progress disabled:opacity-70"
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: isRunning ? 'var(--text-edge)' : 'var(--media)' }}
        />
        {runLabel}
      </button>

      <ReactFlow
        nodes={renderNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.18 }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--grid)" gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
