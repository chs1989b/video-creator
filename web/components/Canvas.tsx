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
import { StageNode, canRunStage, type StageNodeData } from './nodes/StageNode';
import { ResultNode, type ResultNodeData } from './nodes/ResultNode';
import { PreviewNode, type PreviewNodeData } from './nodes/PreviewNode';
import { previewAllowed, unlockAllowed } from '../lib/previewRules';
import {
  createJob,
  getJob,
  runJob,
  runStage,
  resultUrl,
  stageOutputUrl,
  runPreview,
  sendVerdict,
  unlockPreview,
  attemptOutputUrl,
  PREVIEW_CREDITS,
  STAGE_ORDER,
  type Job,
  type StageName,
  type Verdict,
} from '../lib/workerApi';

const nodeTypes = {
  videoInput: VideoInputNode,
  imageInput: ImageInputNode,
  textInput: TextInputNode,
  stage: StageNode,
  result: ResultNode,
  preview: PreviewNode,
};

type AnyNodeData =
  | VideoInputNodeData
  | ImageInputNodeData
  | TextInputNodeData
  | StageNodeData
  | ResultNodeData
  | PreviewNodeData;

const POLL_INTERVAL_MS = 2000;
const LAST_JOB_KEY = 'video-creator:last-job';
const THEME_KEY = 'video-creator:theme';

const MEDIA = 'var(--media)';
const TEXT = 'var(--text-edge)';
const QUIET = 'var(--ink-muted)';

// Positions sketch the pipeline left to right; inputs hang off the stage they
// feed so the picture reads as "what goes into what".
function buildInitialNodes(): Node<AnyNodeData>[] {
  const noop = () => {};
  const stage = (s: StageName): StageNodeData => ({ stage: s, job: null, outputUrl: null, onRun: null, onRetrySegment: null });
  return [
    { id: 'video', type: 'videoInput', position: { x: 0, y: 40 }, data: { url: '', onUrlChange: noop, disabled: false } },
    { id: 'person', type: 'imageInput', position: { x: 20, y: 300 }, data: { title: '바꿀 인물', hint: '인물 사진', file: null, onFileChange: noop, disabled: false } },
    { id: 'product', type: 'imageInput', position: { x: 20, y: 560 }, data: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: null, onFileChange: noop, disabled: false } },
    { id: 'preview', type: 'preview', position: { x: 340, y: 260 }, data: { job: null, onRunPreview: null, onVerdict: null, onUnlock: null, attemptUrl: () => '', previewCredits: PREVIEW_CREDITS } },
    { id: 'generate', type: 'stage', position: { x: 630, y: 300 }, data: stage('generate') },
    { id: 'merge', type: 'stage', position: { x: 920, y: 300 }, data: stage('merge') },
    { id: 'restyle-prompt', type: 'textInput', position: { x: 920, y: 40 }, data: { title: '의상·배경 프롬프트', placeholder: '예: 베이지 셔츠, 배경은 화이트 스튜디오', hint: '비우면 의상·배경은 그대로', value: '', onChange: noop, disabled: false } },
    { id: 'restyle', type: 'stage', position: { x: 1210, y: 300 }, data: stage('restyle') },
    { id: 'edit-prompt', type: 'textInput', position: { x: 1210, y: 560 }, data: { title: '보정 프롬프트', placeholder: '예: 조명을 더 따뜻하게', hint: '비우면 보정 없이 넘어갑니다', value: '', onChange: noop, disabled: false } },
    { id: 'edit', type: 'stage', position: { x: 1500, y: 300 }, data: stage('edit') },
    { id: 'script', type: 'textInput', position: { x: 1500, y: 40 }, data: { title: '나레이션 대본', placeholder: '영상에 얹을 말을 적어주세요', hint: '비우면 음성 없이 만듭니다', value: '', onChange: noop, disabled: false } },
    { id: 'voiceover', type: 'stage', position: { x: 1790, y: 300 }, data: stage('voiceover') },
    { id: 'result', type: 'result', position: { x: 2080, y: 270 }, data: { job: null, resultUrl: null } },
  ];
}

type EdgeSpec = { id: string; source: string; target: string; color: string; stage?: StageName };

const edgeSpecs: EdgeSpec[] = [
  { id: 'video-preview', source: 'video', target: 'preview', color: MEDIA },
  { id: 'person-preview', source: 'person', target: 'preview', color: MEDIA },
  { id: 'product-preview', source: 'product', target: 'preview', color: MEDIA },
  { id: 'preview-generate', source: 'preview', target: 'generate', color: QUIET, stage: 'generate' },
  { id: 'generate-merge', source: 'generate', target: 'merge', color: QUIET, stage: 'merge' },
  { id: 'merge-restyle', source: 'merge', target: 'restyle', color: QUIET, stage: 'restyle' },
  { id: 'restyle-prompt-restyle', source: 'restyle-prompt', target: 'restyle', color: TEXT, stage: 'restyle' },
  { id: 'restyle-edit', source: 'restyle', target: 'edit', color: QUIET, stage: 'edit' },
  { id: 'prompt-edit', source: 'edit-prompt', target: 'edit', color: TEXT, stage: 'edit' },
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
    className:
      job && ((e.stage && job.stages[e.stage]?.status === 'running') || (e.target === 'preview' && job.currentStage === 'preview'))
        ? 'is-running'
        : undefined,
  }));
}

type Theme = 'dark' | 'light';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the page works without it.
  }
}

export function Canvas() {
  const [nodes, , onNodesChange] = useNodesState<Node<AnyNodeData>>(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges(null));

  const [theme, setTheme] = useState<Theme>('dark');
  const [url, setUrl] = useState('');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [restylePrompt, setRestylePrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [script, setScript] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Theme: applied on the root element so every token flips at once.
  useEffect(() => {
    const saved = readStorage(THEME_KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_KEY, theme);
  }, [theme]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const updated = await getJob(id);
          setJob(updated);
          if (updated.status !== 'running') stopPolling();
        } catch {
          // A missed poll is harmless; the next one catches up.
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  useEffect(() => stopPolling, [stopPolling]);

  // Reopen the last job, so a saved pipeline can be resumed after a reload.
  useEffect(() => {
    const lastId = readStorage(LAST_JOB_KEY);
    if (!lastId) return;
    getJob(lastId)
      .then((saved) => {
        setJob(saved);
        if (saved.youtubeUrl) setUrl(saved.youtubeUrl);
        if (saved.restylePrompt) setRestylePrompt(saved.restylePrompt);
        if (saved.editPrompt) setEditPrompt(saved.editPrompt);
        if (saved.script) setScript(saved.script);
        if (saved.status === 'running') startPolling(saved.id);
      })
      .catch(() => writeStorage(LAST_JOB_KEY, null));
  }, [startPolling]);

  useEffect(() => {
    setEdges(buildEdges(job));
  }, [job, setEdges]);

  const isRunning = job?.status === 'running';
  const locked = isRunning || isSubmitting || (job !== null && job.status !== 'done' && job.status !== 'failed' && job.status !== 'idle');
  const inputsLocked = job !== null || isSubmitting;

  const submit = useCallback(
    async (autorun: boolean) => {
      if (!url || !personFile) {
        setErrorMessage('원본 영상 링크와 바꿀 인물 사진이 필요합니다.');
        return null;
      }
      setErrorMessage(null);
      setIsSubmitting(true);
      try {
        const created = await createJob({
          youtubeUrl: url,
          characterImage: personFile,
          productImage: productFile,
          script,
          restylePrompt,
          editPrompt,
          autorun,
          preview: true,
        });
        setJob(created);
        writeStorage(LAST_JOB_KEY, created.id);
        if (autorun) startPolling(created.id);
        return created;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '작업을 시작하지 못했습니다.');
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [url, personFile, productFile, script, restylePrompt, editPrompt, startPolling],
  );

  const handleRunPreview = useCallback(async () => {
    setErrorMessage(null);
    let target = job;
    if (!target) {
      target = await submit(false);
      if (!target) return;
    }
    try {
      await runPreview(target.id);
      setJob({ ...target, status: 'running', currentStage: 'preview' });
      startPolling(target.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '미리보기를 시작하지 못했습니다.');
    }
  }, [job, submit, startPolling]);

  const handleVerdict = useCallback(
    async (attemptId: string, verdict: Verdict, reasons: string[]) => {
      if (!job) return;
      setErrorMessage(null);
      try {
        setJob(await sendVerdict(job.id, attemptId, verdict, reasons));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '판정을 저장하지 못했습니다.');
      }
    },
    [job],
  );

  const handleUnlock = useCallback(async () => {
    if (!job) return;
    if (!window.confirm(`미리보기 1회를 더 허용할까요? 약 ${PREVIEW_CREDITS}크레딧(약 ${(PREVIEW_CREDITS * 60).toLocaleString()}원)이 듭니다.`)) return;
    try {
      setJob(await unlockPreview(job.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '한도를 풀지 못했습니다.');
    }
  }, [job]);

  const handleRunAll = useCallback(async () => {
    if (!job) {
      await handleRunPreview();
      return;
    }
    setErrorMessage(null);
    try {
      await runJob(job.id);
      setJob({ ...job, status: 'running' });
      startPolling(job.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '이어서 실행하지 못했습니다.');
    }
  }, [job, handleRunPreview, startPolling]);

  const handleRunStage = useCallback(
    async (stage: StageName) => {
      setErrorMessage(null);
      let target = job;
      if (!target) {
        target = await submit(false);
        if (!target) return;
      }
      try {
        await runStage(target.id, stage);
        setJob({ ...target, status: 'running', currentStage: stage });
        startPolling(target.id);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '단계를 실행하지 못했습니다.');
      }
    },
    [job, submit, startPolling],
  );

  const handleRetrySegment = useCallback(
    async (index: number) => {
      if (!job) return;
      setErrorMessage(null);
      const base = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:4000';
      setJob({ ...job, status: 'running', currentStage: 'generate' });
      startPolling(job.id);
      try {
        const res = await fetch(`${base}/jobs/${job.id}/segments/${index}/retry`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string });
          setErrorMessage(body.error ?? `구간 ${index + 1} 재시도 실패`);
        }
      } catch {
        setErrorMessage('워커 서버에 연결할 수 없습니다.');
      }
    },
    [job, startPolling],
  );

  const handleReset = useCallback(() => {
    stopPolling();
    setJob(null);
    setErrorMessage(null);
    writeStorage(LAST_JOB_KEY, null);
  }, [stopPolling]);

  const dataById = useMemo<Record<string, AnyNodeData>>(() => {
    const stageData = (stage: StageName): StageNodeData => ({
      stage,
      job,
      outputUrl: job && job.stages[stage]?.status === 'done' && stage !== 'generate' ? stageOutputUrl(job.id, stage) : null,
      onRun:
        job && canRunStage(job, stage)
          ? () => handleRunStage(stage)
          : null,
      onRetrySegment: stage === 'generate' && job ? handleRetrySegment : null,
    });
    return {
      video: { url, onUrlChange: setUrl, disabled: inputsLocked },
      person: { title: '바꿀 인물', hint: '인물 사진', file: personFile, onFileChange: setPersonFile, disabled: inputsLocked },
      product: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: productFile, onFileChange: setProductFile, disabled: inputsLocked },
      'restyle-prompt': {
        title: '의상·배경 프롬프트',
        placeholder: '예: 베이지 셔츠, 배경은 화이트 스튜디오',
        hint: '비우면 의상·배경은 그대로',
        value: restylePrompt,
        onChange: setRestylePrompt,
        disabled: inputsLocked,
      },
      'edit-prompt': {
        title: '보정 프롬프트',
        placeholder: '예: 조명을 더 따뜻하게',
        hint: '비우면 보정 없이 넘어갑니다',
        value: editPrompt,
        onChange: setEditPrompt,
        disabled: inputsLocked,
      },
      script: {
        title: '나레이션 대본',
        placeholder: '영상에 얹을 말을 적어주세요',
        hint: '비우면 음성 없이 만듭니다',
        value: script,
        onChange: setScript,
        disabled: inputsLocked,
      },
      generate: stageData('generate'),
      merge: stageData('merge'),
      restyle: stageData('restyle'),
      edit: stageData('edit'),
      voiceover: stageData('voiceover'),
      result: { job, resultUrl: job?.status === 'done' ? resultUrl(job.id) : null },
      preview: {
        job,
        onRunPreview: (!job && !isSubmitting) || (job && previewAllowed(job)) ? handleRunPreview : null,
        onVerdict: job ? handleVerdict : null,
        onUnlock: job && unlockAllowed(job) ? handleUnlock : null,
        attemptUrl: (attemptId: string) => (job ? attemptOutputUrl(job.id, attemptId) : ''),
        previewCredits: job?.segments[0]
          ? Math.round((job.segments[0].endSeconds - job.segments[0].startSeconds) * 7)
          : PREVIEW_CREDITS,
      },
    };
  }, [url, personFile, productFile, restylePrompt, editPrompt, script, job, inputsLocked, isSubmitting, handleRunStage, handleRetrySegment, handleRunPreview, handleVerdict, handleUnlock]);

  const renderNodes = useMemo(
    () => nodes.map((node) => ({ ...node, data: dataById[node.id] ?? node.data })),
    [nodes, dataById],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const remaining = job ? STAGE_ORDER.some((s) => ['pending', 'failed'].includes(job.stages[s]?.status)) : false;
  const awaitingApproval = Boolean(job?.previewRequired && !job.approvedAttemptId);
  const runLabel = isSubmitting
    ? '보내는 중'
    : isRunning
      ? '만드는 중'
      : !job
        ? '5초 미리보기 만들기'
        : awaitingApproval
          ? '미리보기를 승인하세요'
          : job.status === 'done'
            ? '완성됨'
            : job.status === 'failed'
              ? '실패한 단계부터 이어서'
              : '남은 단계 모두 실행';
  const runDisabled = locked || awaitingApproval || (job !== null && !remaining);

  return (
    <div className="relative h-screen w-screen bg-[var(--canvas)]">
      <div className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-3 text-[13px] font-medium text-[var(--ink)]">
        <span>얼굴·제품 교체 워크플로</span>
        {job?.previewRequired && job.totals && (
          <span className="rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] px-2.5 py-1 text-[12px] font-normal text-[var(--ink-muted)]">
            미리보기 {job.totals.previews}회 · {job.totals.credits}크레딧 · 약 {job.totals.krw.toLocaleString()}원
          </span>
        )}
      </div>

      <div className="absolute right-5 top-4 z-10 flex items-center gap-2">
        {job && (
          <button
            type="button"
            onClick={handleReset}
            disabled={isRunning}
            className="rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            새 작업
          </button>
        )}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          className="rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:border-[var(--media)]"
        >
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
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
        onClick={handleRunAll}
        disabled={runDisabled}
        className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-[var(--card-border-strong)] bg-[var(--pill)] px-6 py-3 text-[14px] font-medium tracking-wide text-[var(--ink)] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur transition-colors hover:border-[var(--media)] disabled:cursor-default disabled:opacity-70"
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: isRunning ? 'var(--text-edge)' : job?.status === 'failed' ? 'var(--danger)' : 'var(--media)' }}
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
        fitViewOptions={{ padding: 0.08 }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--grid)" gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
