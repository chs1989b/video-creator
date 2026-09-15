'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
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
import { CharacterInputNode, type CharacterInputNodeData } from './nodes/CharacterInputNode';
import { GenerateStatusNode, type GenerateStatusNodeData } from './nodes/GenerateStatusNode';
import { MergeStatusNode, type MergeStatusNodeData } from './nodes/MergeStatusNode';
import { ResultNode, type ResultNodeData } from './nodes/ResultNode';
import { createJob, getJob, resultUrl, type Job } from '../lib/workerApi';

const nodeTypes = {
  videoInput: VideoInputNode,
  characterInput: CharacterInputNode,
  generateStatus: GenerateStatusNode,
  mergeStatus: MergeStatusNode,
  result: ResultNode,
};

type AnyNodeData =
  | VideoInputNodeData
  | CharacterInputNodeData
  | GenerateStatusNodeData
  | MergeStatusNodeData
  | ResultNodeData;

const POLL_INTERVAL_MS = 2000;

function buildInitialNodes(): Node<AnyNodeData>[] {
  return [
    {
      id: 'video-input',
      type: 'videoInput',
      position: { x: 0, y: 0 },
      data: { url: '', onUrlChange: () => {}, disabled: false },
    },
    {
      id: 'character-input',
      type: 'characterInput',
      position: { x: 0, y: 180 },
      data: { fileName: null, onFileChange: () => {}, disabled: false },
    },
    {
      id: 'generate',
      type: 'generateStatus',
      position: { x: 340, y: 90 },
      data: { job: null },
    },
    {
      id: 'merge',
      type: 'mergeStatus',
      position: { x: 660, y: 90 },
      data: { job: null },
    },
    {
      id: 'result',
      type: 'result',
      position: { x: 980, y: 90 },
      data: { job: null, resultUrl: null },
    },
  ];
}

const initialEdges: Edge[] = [
  { id: 'e-video-generate', source: 'video-input', target: 'generate' },
  { id: 'e-character-generate', source: 'character-input', target: 'generate' },
  { id: 'e-generate-merge', source: 'generate', target: 'merge' },
  { id: 'e-merge-result', source: 'merge', target: 'result' },
];

export function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AnyNodeData>>(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  const [url, setUrl] = useState('');
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = job !== null && job.status !== 'done' && job.status !== 'failed';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const handleRun = useCallback(async () => {
    if (!url || !characterFile) {
      setErrorMessage('유튜브 URL과 캐릭터 이미지를 모두 입력해주세요.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const created = await createJob(url, characterFile);
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
          // 스펙 §8: 폴링 중 네트워크 오류는 조용히 다음 폴링에서 재시도 (배너 없음, YAGNI).
          // 워커가 완전히 죽은 경우 무한 재시도가 되지만, 개인용 로컬 도구 규모에서는
          // 사용자가 워커 로그를 직접 보고 문제를 알아채는 것으로 충분하다고 판단함.
        }
      }, POLL_INTERVAL_MS);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '작업 생성에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  }, [url, characterFile, stopPolling]);

  // 노드 위치(드래그 결과)는 useNodesState가 자체적으로 유지함.
  // 여기서는 각 노드의 `data`만 최신 상태로 갱신 — 위치는 건드리지 않음.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id === 'video-input') {
          const data: VideoInputNodeData = { url, onUrlChange: setUrl, disabled: isRunning };
          return { ...node, data };
        }
        if (node.id === 'character-input') {
          const data: CharacterInputNodeData = {
            fileName: characterFile?.name ?? null,
            onFileChange: setCharacterFile,
            disabled: isRunning,
          };
          return { ...node, data };
        }
        if (node.id === 'generate') {
          const data: GenerateStatusNodeData = { job };
          return { ...node, data };
        }
        if (node.id === 'merge') {
          const data: MergeStatusNodeData = { job };
          return { ...node, data };
        }
        if (node.id === 'result') {
          const data: ResultNodeData = { job, resultUrl: job ? resultUrl(job.id) : null };
          return { ...node, data };
        }
        return node;
      }),
    );
  }, [url, characterFile, job, isRunning, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div className="relative h-screen w-screen bg-slate-950">
      {errorMessage && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded bg-red-900/90 px-4 py-2 text-sm text-red-100 shadow-lg">
          {errorMessage}
        </div>
      )}
      <button
        onClick={handleRun}
        disabled={isSubmitting || isRunning}
        className="absolute left-4 top-4 z-10 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white shadow-lg hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        {isRunning ? '생성 중...' : '실행'}
      </button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
