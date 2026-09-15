'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  {
    id: 'e-video-generate',
    source: 'video-input',
    target: 'generate',
    style: { stroke: '#892DBE', strokeWidth: 2 },
  },
  {
    id: 'e-character-generate',
    source: 'character-input',
    target: 'generate',
    style: { stroke: '#3BC48D', strokeWidth: 2 },
  },
  {
    id: 'e-generate-merge',
    source: 'generate',
    target: 'merge',
    style: { stroke: '#72727A', strokeWidth: 2 },
  },
  {
    id: 'e-merge-result',
    source: 'merge',
    target: 'result',
    style: { stroke: '#72727A', strokeWidth: 2 },
  },
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
  // 각 노드의 `data`는 렌더 시점에 useMemo로 파생시켜 위치와 분리함
  // (setNodes를 통한 useEffect 동기화는 불필요한 추가 렌더를 유발하므로 사용하지 않음).
  const dataById = useMemo<Record<string, AnyNodeData>>(
    () => ({
      'video-input': { url, onUrlChange: setUrl, disabled: isRunning || isSubmitting },
      'character-input': {
        fileName: characterFile?.name ?? null,
        onFileChange: setCharacterFile,
        disabled: isRunning || isSubmitting,
      },
      generate: { job },
      merge: { job },
      result: { job, resultUrl: job ? resultUrl(job.id) : null },
    }),
    [url, characterFile, job, isRunning, isSubmitting],
  );

  const renderNodes = useMemo(
    () => nodes.map((node) => ({ ...node, data: dataById[node.id] ?? node.data })),
    [nodes, dataById],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div className="relative h-screen w-screen bg-[#0A0A0A]">
      {errorMessage && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border border-[#F2495C] bg-[#16161A] px-4 py-2 text-sm text-[#F2495C]">
          {errorMessage}
        </div>
      )}
      <button
        onClick={handleRun}
        disabled={isSubmitting || isRunning}
        className="absolute left-4 top-4 z-10 rounded-full border border-[#42424D] bg-[#16161A] px-4 py-2 text-sm font-medium text-[#FAFAFA] transition-colors hover:border-[#3BC48D] hover:text-[#3BC48D] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? '생성 중...' : '실행'}
      </button>
      <ReactFlow
        nodes={renderNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background color="#232329" gap={24} size={1} />
        <Controls className="[&_button]:border-[#42424D] [&_button]:bg-[#16161A] [&_button]:text-[#FAFAFA] [&_button]:fill-[#FAFAFA] [&_button:hover]:bg-[#2A2A30]" />
      </ReactFlow>
    </div>
  );
}
