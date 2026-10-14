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
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { VideoInputNode, type VideoInputNodeData } from './nodes/VideoInputNode';
import { ImageInputNode, type ImageInputNodeData } from './nodes/ImageInputNode';
import { TextInputNode, type TextInputNodeData } from './nodes/TextInputNode';
import { StageNode, canRunStage, type StageNodeData } from './nodes/StageNode';
import { ResultNode, type ResultNodeData } from './nodes/ResultNode';
import { PreviewNode, type PreviewNodeData } from './nodes/PreviewNode';
import { NodePalette, PALETTE_MIME } from './NodePalette';
import { JobHistory } from './JobHistory';
import { StatsPanel } from './StatsPanel';
import { HiggsfieldConnect } from './HiggsfieldConnect';
import { previewAllowed, unlockAllowed, inputEditable, approvalWaitLabel } from '../lib/previewRules';
import { sourceInputError } from '../lib/sourceInput';
import { modeBanner, type ModeBanner } from '../lib/modeBanner';
import { jobVideoSeconds } from '../lib/narration';
import { DEFAULT_RESOLUTION, previewCreditsFor, resolutionOptions, toKrw, type PriceTable, type Resolution } from '../lib/costs';
import {
  OPTIONAL_NODES,
  hiddenNodeIds,
  NODE_IDS,
  pipelineEdges,
  canToggle,
  presentFromJob,
  optionalNodeOf,
  dropPlacement,
  lockReason,
  type OptionalNode,
} from '../lib/pipelineGraph';
import {
  createJob,
  getJob,
  runJob,
  runStage,
  resultUrl,
  jobImageUrl,
  stageOutputUrl,
  runPreview,
  sendVerdict,
  unlockPreview,
  attemptOutputUrl,
  updateJobInputs,
  getConfig,
  STAGE_ORDER,
  type Job,
  type StageName,
  type Verdict,
  type JobInputs,
  getVoices,
  type Voice,
} from '../lib/workerApi';

// Same default as the worker (pipeline/voices.js).
const DEFAULT_VOICE_KEY = 'female-1';

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
const BANNER_BORDER: Record<ModeBanner['tone'], string> = {
  mock: 'border-[var(--text-edge)]',
  real: 'border-[var(--media)]',
  warn: 'border-[var(--danger)]',
};
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
    { id: 'video', type: 'videoInput', position: { x: 0, y: 40 }, data: { url: '', onUrlChange: noop, file: null, onFileChange: noop, savedName: null, disabled: false } },
    { id: 'person', type: 'imageInput', position: { x: 20, y: 300 }, data: { title: '바꿀 인물', hint: '인물 사진', file: null, onFileChange: noop, disabled: false } },
    { id: 'product', type: 'imageInput', position: { x: 20, y: 560 }, data: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: null, onFileChange: noop, disabled: false } },
    { id: 'preview', type: 'preview', position: { x: 340, y: 260 }, data: { job: null, onRunPreview: null, onVerdict: null, onUnlock: null, attemptUrl: () => '', previewCredits: null, resolutionOptions: [], resolution: DEFAULT_RESOLUTION, onResolutionChange: null, prompt: '', onPromptChange: noop } },
    { id: 'generate', type: 'stage', position: { x: 630, y: 300 }, data: stage('generate') },
    { id: 'merge', type: 'stage', position: { x: 920, y: 300 }, data: stage('merge') },
    { id: 'restyle-prompt', type: 'textInput', position: { x: 920, y: 40 }, data: { title: '의상·배경 프롬프트', placeholder: '예: 베이지 셔츠, 배경은 화이트 스튜디오', hint: '비우면 의상·배경은 그대로', value: '', onChange: noop, disabled: false } },
    { id: 'restyle', type: 'stage', position: { x: 1210, y: 300 }, data: stage('restyle') },
    { id: 'edit-prompt', type: 'textInput', position: { x: 1210, y: 560 }, data: { title: '최종 보정 프롬프트', placeholder: '예: 조명을 더 따뜻하게', hint: '비우면 보정 없이 넘어갑니다', value: '', onChange: noop, disabled: false } },
    { id: 'edit', type: 'stage', position: { x: 1500, y: 300 }, data: stage('edit') },
    { id: 'script', type: 'textInput', position: { x: 1500, y: 40 }, data: { title: '나레이션 대본', placeholder: '영상에 얹을 말을 적어주세요', hint: '비우면 음성 없이 만듭니다', value: '', onChange: noop, disabled: false } },
    { id: 'voiceover', type: 'stage', position: { x: 1790, y: 300 }, data: stage('voiceover') },
    { id: 'result', type: 'result', position: { x: 2080, y: 270 }, data: { job: null, resultUrl: null } },
  ];
}

function buildEdges(job: Job | null, present: Set<OptionalNode>): Edge[] {
  const color = { media: MEDIA, text: TEXT, flow: QUIET } as const;
  return pipelineEdges(present).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: color[e.kind] },
    className:
      job && ((e.stage && job.stages[e.stage]?.status === 'running') || (e.target === 'preview' && job.currentStage === 'preview'))
        ? 'is-running'
        : undefined,
  }));
}

const isOptional = (stage: StageName): stage is 'restyle' | 'edit' | 'voiceover' =>
  stage === 'restyle' || stage === 'edit' || stage === 'voiceover';

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
  const [nodes, setNodes, onBaseNodesChange] = useNodesState<Node<AnyNodeData>>(buildInitialNodes());
  const [flow, setFlow] = useState<Pick<ReactFlowInstance, 'screenToFlowPosition'> | null>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const [paletteDropActive, setPaletteDropActive] = useState(false);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(buildEdges(null, new Set(OPTIONAL_NODES)));
  // Optional cards currently on the canvas (the user adds and removes them).
  const [present, setPresent] = useState<Set<OptionalNode>>(() => new Set(OPTIONAL_NODES));

  const [theme, setTheme] = useState<Theme>('dark');
  const [url, setUrl] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [restylePrompt, setRestylePrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [script, setScript] = useState('');
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [voiceKey, setVoiceKey] = useState(DEFAULT_VOICE_KEY);
  const [resolution, setResolution] = useState<Resolution>(DEFAULT_RESOLUTION);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [user, setUser] = useState<{ username: string; name: string } | null>(null);
  // Bottom-right panels: at most one open, so they never cover each other.
  const [openPanel, setOpenPanel] = useState<'stats' | 'history' | null>(null);
  const togglePanel = (panel: 'stats' | 'history') => setOpenPanel((cur) => (cur === panel ? null : panel));
  // The last job is remembered per demo user, so signing in as someone else starts clean.
  const lastJobKey = user ? `${LAST_JOB_KEY}:${user.username}` : null;
  const [workerMock, setWorkerMock] = useState(false);
  // Prices come from the worker's own table; null until /config answers.
  const [prices, setPrices] = useState<PriceTable | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Photos the job was created with: a different pick is sent with every later preview.
  const createdFilesRef = useRef<{ person: File | null; product: File | null }>({ person: null, product: null });
  // Blocks a second click while a preview request is on its way (each preview costs credits).
  const previewPendingRef = useRef(false);

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

  // Test mode: a worker started with GENERATOR=mock spends no credits.
  useEffect(() => {
    getConfig()
      .then((config) => {
        setWorkerMock(config.generator === 'mock');
        setPrices(config.prices ?? null);
      })
      .catch(() => setWorkerMock(false));
  }, []);

  // Signed-in demo user (the middleware already sent anyone else to /login).
  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (res.ok) setUser(await res.json());
      })
      .catch(() => setErrorMessage('웹 서버에 연결할 수 없습니다.'));
  }, []);

  // Narration voices (and which sample clips this machine has), once signed in.
  useEffect(() => {
    if (!user) return;
    getVoices().then(setVoices).catch(() => setVoices([]));
  }, [user]);

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }, []);

  /** Put a saved job on the canvas: its inputs, its optional nodes, and polling if it is still running. */
  const showJob = useCallback(
    (saved: Job) => {
      stopPolling();
      setJob(saved);
      setErrorMessage(null);
      setUrl(saved.youtubeUrl ?? '');
      setSourceFile(null);
      setPersonFile(null);
      setProductFile(null);
      setPreviewPrompt('');
      setRestylePrompt(saved.restylePrompt ?? '');
      setEditPrompt(saved.editPrompt ?? '');
      setScript(saved.script ?? '');
      setVoiceKey(saved.voiceKey ?? DEFAULT_VOICE_KEY);
      setResolution((saved.resolution as Resolution | undefined) ?? DEFAULT_RESOLUTION);
      setPresent(presentFromJob(saved));
      if (saved.status === 'running') startPolling(saved.id);
    },
    [startPolling, stopPolling],
  );

  // Reopen this user's last job, so a saved pipeline can be resumed after a reload.
  useEffect(() => {
    if (!lastJobKey) return;
    const lastId = readStorage(lastJobKey);
    if (!lastId) return;
    getJob(lastId)
      .then(showJob)
      .catch(() => writeStorage(lastJobKey, null));
  }, [lastJobKey, showJob]);

  /** History panel: load another of this user's jobs. */
  const openJob = useCallback(
    async (id: string) => {
      try {
        const saved = await getJob(id);
        showJob(saved);
        if (lastJobKey) writeStorage(lastJobKey, saved.id);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '작업을 불러오지 못했습니다.');
      }
    },
    [showJob, lastJobKey],
  );

  useEffect(() => {
    setEdges(buildEdges(job, present));
  }, [job, present, setEdges]);

  const isRunning = job?.status === 'running';
  const locked = isRunning || isSubmitting || (job !== null && job.status !== 'done' && job.status !== 'failed' && job.status !== 'idle');
  const inputsLocked = job !== null || isSubmitting;
  // Between previews the photos can change: the next preview uses the new pick.
  const photosLocked = inputsLocked && !(job && previewAllowed(job));

  const submit = useCallback(
    async (autorun: boolean) => {
      const sourceError = sourceInputError({ url, file: sourceFile });
      if (sourceError || !personFile) {
        setErrorMessage(sourceError ?? '바꿀 인물 사진이 필요합니다.');
        return null;
      }
      setErrorMessage(null);
      setIsSubmitting(true);
      try {
        const created = await createJob({
          youtubeUrl: sourceFile ? null : url,
          sourceVideo: sourceFile,
          voiceKey,
          resolution,
          characterImage: personFile,
          productImage: productFile,
          script,
          restylePrompt,
          editPrompt,
          autorun,
          preview: true,
        });
        setJob(created);
        if (lastJobKey) writeStorage(lastJobKey, created.id);
        if (autorun) startPolling(created.id);
        return created;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '작업을 시작하지 못했습니다.');
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [url, sourceFile, personFile, productFile, script, restylePrompt, editPrompt, voiceKey, resolution, startPolling, lastJobKey],
  );

  // Prompts/script typed after approval, not yet saved on the job.
  const editsFor = useCallback(
    (target: Job): JobInputs => {
      const edits: JobInputs = {};
      const fields = [
        ['restylePrompt', 'restyle', restylePrompt],
        ['editPrompt', 'edit', editPrompt],
        ['script', 'voiceover', script],
      ] as const;
      for (const [field, stage, value] of fields) {
        if (inputEditable(target, stage) && (value.trim() || null) !== (target[field] ?? null)) edits[field] = value;
      }
      if (inputEditable(target, 'voiceover') && voiceKey !== (target.voiceKey ?? DEFAULT_VOICE_KEY)) edits.voiceKey = voiceKey;
      return edits;
    },
    [restylePrompt, editPrompt, script, voiceKey],
  );

  const syncInputs = useCallback(
    async (target: Job): Promise<Job> => {
      const edits = editsFor(target);
      if (Object.keys(edits).length === 0) return target;
      const updated = await updateJobInputs(target.id, edits);
      setJob(updated);
      return updated;
    },
    [editsFor],
  );

  const handleRunPreview = useCallback(async () => {
    if (previewPendingRef.current) return;
    previewPendingRef.current = true;
    setErrorMessage(null);
    try {
      let target = job;
      if (!target) {
        target = await submit(false);
        if (!target) return;
        createdFilesRef.current = { person: personFile, product: productFile };
      }
      const created = createdFilesRef.current;
      await runPreview(target.id, {
        prompt: previewPrompt,
        characterImage: personFile && personFile !== created.person ? personFile : null,
        productImage: productFile && productFile !== created.product ? productFile : null,
      });
      setJob({ ...target, status: 'running', currentStage: 'preview' });
      startPolling(target.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '미리보기를 시작하지 못했습니다.');
    } finally {
      previewPendingRef.current = false;
    }
  }, [job, submit, startPolling, previewPrompt, personFile, productFile]);

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
    const cost = job.estimate?.previewCredits;
    const price = cost == null ? '' : ` 약 ${cost}크레딧${prices ? `(약 ${toKrw(prices, cost).toLocaleString()}원)` : ''}이 듭니다.`;
    if (!window.confirm(`미리보기 1회를 더 허용할까요?${price}`)) return;
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
      const target = await syncInputs(job);
      await runJob(target.id);
      setJob({ ...target, status: 'running' });
      startPolling(target.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '이어서 실행하지 못했습니다.');
    }
  }, [job, handleRunPreview, startPolling, syncInputs]);

  const handleRunStage = useCallback(
    async (stage: StageName) => {
      setErrorMessage(null);
      let target = job;
      if (!target) {
        target = await submit(false);
        if (!target) return;
      }
      try {
        target = await syncInputs(target);
        await runStage(target.id, stage);
        setJob({ ...target, status: 'running', currentStage: stage });
        startPolling(target.id);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '단계를 실행하지 못했습니다.');
      }
    },
    [job, submit, startPolling, syncInputs],
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

  const removeNode = useCallback(
    (node: OptionalNode) => {
      if (!canToggle(job, node)) return;
      setPresent((cur) => new Set([...cur].filter((n) => n !== node)));
      // A removed card's input is cleared, so its stage is skipped.
      if (node === 'product') setProductFile(null);
      if (node === 'restyle') setRestylePrompt('');
      if (node === 'edit') setEditPrompt('');
      if (node === 'voiceover') setScript('');
    },
    [job],
  );

  const addNode = useCallback(
    (node: OptionalNode) => {
      if (!canToggle(job, node)) return;
      setPresent((cur) => new Set([...cur, node]));
    },
    [job],
  );

  // Cards are never really deleted: a removed optional node is hidden and its
  // input cleared, so Delete/Backspace on a required card does nothing.
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<AnyNodeData>>[]) => {
      for (const change of changes) {
        if (change.type !== 'remove') continue;
        const node = optionalNodeOf(change.id);
        if (node) removeNode(node);
      }
      onBaseNodesChange(changes.filter((c) => c.type !== 'remove'));
    },
    [onBaseNodesChange, removeNode],
  );

  const moveCards = useCallback(
    (placement: Record<string, { x: number; y: number }>) =>
      setNodes((ns) => ns.map((n) => (placement[n.id] ? { ...n, position: placement[n.id] } : n))),
    [setNodes],
  );

  /** Palette "붙이기" button: the cards go back to their usual place. */
  const attachAtHome = useCallback(
    (node: OptionalNode) => {
      const home = Object.fromEntries(buildInitialNodes().map((n) => [n.id, n.position]));
      moveCards(Object.fromEntries(NODE_IDS[node].map((id) => [id, home[id]])));
      addNode(node);
    },
    [addNode, moveCards],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const node = event.dataTransfer.getData(PALETTE_MIME) as OptionalNode;
      if (!node || !flow || !canToggle(job, node)) return;
      event.preventDefault();
      moveCards(dropPlacement(node, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })));
      addNode(node);
    },
    [flow, job, addNode, moveCards],
  );

  const overPalette = (event: MouseEvent | TouchEvent) => {
    const point = 'touches' in event ? event.changedTouches[0] : event;
    const rect = paletteRef.current?.getBoundingClientRect();
    return Boolean(point && rect && point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom);
  };

  const onNodeDrag = useCallback((event: MouseEvent | TouchEvent, card: Node) => {
    const node = optionalNodeOf(card.id);
    setPaletteDropActive(Boolean(node && canToggle(job, node) && overPalette(event)));
  }, [job]);

  const onNodeDragStop = useCallback(
    (event: MouseEvent | TouchEvent, card: Node) => {
      setPaletteDropActive(false);
      const node = optionalNodeOf(card.id);
      if (node && overPalette(event)) removeNode(node);
    },
    [removeNode],
  );

  const nodeLockReason = useCallback(
    (node: OptionalNode) => lockReason(job, node, present),
    [job, present],
  );

  const handleReset = useCallback(() => {
    setPresent(new Set(OPTIONAL_NODES));
    stopPolling();
    setJob(null);
    setErrorMessage(null);
    if (lastJobKey) writeStorage(lastJobKey, null);
  }, [stopPolling, lastJobKey]);

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
      onRemove: isOptional(stage) && canToggle(job, stage) ? () => removeNode(stage) : null,
      screenHasInput: isOptional(stage) ? Boolean(screenInput[stage].trim()) : null,
    });
    const screenInput = { restyle: restylePrompt, edit: editPrompt, voiceover: script };
    const removeFor = (node: OptionalNode) => (canToggle(job, node) ? () => removeNode(node) : null);
    return {
      video: { url, onUrlChange: setUrl, file: sourceFile, onFileChange: setSourceFile, savedName: job?.sourceVideoName ?? null, disabled: inputsLocked },
      person: { title: '바꿀 인물', hint: '인물 사진', file: personFile, onFileChange: setPersonFile, disabled: photosLocked, savedUrl: job ? jobImageUrl(job.id, 'character') : null },
      product: { title: '바꿀 제품', hint: '제품 사진 (선택)', file: productFile, onFileChange: setProductFile, disabled: photosLocked, onRemove: removeFor('product'), savedUrl: job?.productImagePaths?.length ? jobImageUrl(job.id, 'product') : null },
      'restyle-prompt': {
        title: '의상·배경 프롬프트',
        placeholder: '예: 베이지 셔츠, 배경은 화이트 스튜디오',
        hint: '비우면 의상·배경은 그대로',
        value: restylePrompt,
        onChange: setRestylePrompt,
        disabled: isSubmitting || !inputEditable(job, 'restyle'),
        onRemove: removeFor('restyle'),
        refineStage: 'restyle',
      },
      'edit-prompt': {
        title: '최종 보정 프롬프트',
        placeholder: '예: 조명을 더 따뜻하게',
        hint: '비우면 보정 없이 넘어갑니다',
        value: editPrompt,
        onChange: setEditPrompt,
        disabled: isSubmitting || !inputEditable(job, 'edit'),
        onRemove: removeFor('edit'),
        refineStage: 'edit',
      },
      script: {
        title: '나레이션 대본',
        placeholder: '영상에 얹을 말을 적어주세요',
        hint: '비우면 음성 없이 만듭니다',
        value: script,
        onChange: setScript,
        disabled: isSubmitting || !inputEditable(job, 'voiceover'),
        onRemove: removeFor('voiceover'),
        voice: { voices, value: voiceKey, onChange: setVoiceKey, disabled: isSubmitting || !inputEditable(job, 'voiceover'), videoSeconds: jobVideoSeconds(job, Boolean(restylePrompt.trim() || editPrompt.trim())) },
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
        previewCredits: job ? job.estimate?.previewCredits ?? null : prices ? previewCreditsFor(prices, resolution) : null,
        resolutionOptions: prices ? resolutionOptions(prices) : [],
        resolution: ((job?.resolution as Resolution | undefined) ?? resolution),
        onResolutionChange: job ? null : setResolution,
        prompt: previewPrompt,
        onPromptChange: setPreviewPrompt,
      },
    };
  }, [url, sourceFile, personFile, productFile, restylePrompt, editPrompt, script, voiceKey, voices, job, inputsLocked, isSubmitting, handleRunStage, handleRetrySegment, handleRunPreview, handleVerdict, handleUnlock, previewPrompt, photosLocked, removeNode, resolution]);

  const renderNodes = useMemo(
    () => {
      const hidden = hiddenNodeIds(present);
      return nodes.map((node) => ({ ...node, hidden: hidden.has(node.id), data: dataById[node.id] ?? node.data }));
    },
    [nodes, dataById, present],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const hasEdits = job ? Object.keys(editsFor(job)).length > 0 : false;
  const remaining = job ? hasEdits || STAGE_ORDER.some((s) => ['pending', 'failed'].includes(job.stages[s]?.status)) : false;
  const awaitingApproval = Boolean(job?.previewRequired && !job.approvedAttemptId);
  const runLabel = isSubmitting
    ? '보내는 중'
    : isRunning
      ? '만드는 중'
      : !job
        ? '5초 미리보기 만들기'
        : awaitingApproval && job
          ? approvalWaitLabel(job)
          : job.status === 'done' && !hasEdits
            ? '완성됨'
            : job.status === 'failed'
              ? '실패한 단계부터 이어서'
              : '남은 단계 모두 실행';
  const runDisabled = locked || awaitingApproval || (job !== null && !remaining);

  const banner = modeBanner(workerMock, job);

  return (
    <div className="flex h-screen w-screen bg-[var(--canvas)]">
      <NodePalette
        ref={paletteRef}
        present={present}
        lockReason={nodeLockReason}
        onAttach={attachAtHome}
        onDetach={removeNode}
        dropActive={paletteDropActive}
        prices={prices}
      />
    <div className="relative h-full flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-3 text-[13px] font-medium text-[var(--ink)]">
        <span>얼굴·제품 교체 워크플로</span>
        {banner && (
          <span className={`rounded-full border ${BANNER_BORDER[banner.tone]} bg-[var(--card)] px-2.5 py-1 text-[12px] font-normal text-[var(--ink)]`}>
            {banner.text}
          </span>
        )}
        {job?.previewRequired && job.totals && (
          <span className="rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] px-2.5 py-1 text-[12px] font-normal text-[var(--ink-muted)]">
            {job.mock ? '실제였다면 ' : ''}미리보기 {job.totals.previews}회 · {job.totals.credits}크레딧 · 약 {job.totals.krw.toLocaleString()}원
          </span>
        )}
      </div>

      <div className="absolute right-5 top-4 z-10 flex items-center gap-2">
        <HiggsfieldConnect />
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
        {user && (
          <span className="flex items-center gap-2 rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] py-1 pl-3 pr-1 text-[12px] text-[var(--ink)]">
            {user.name}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-[var(--card-border)] px-2.5 py-0.5 text-[11.5px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              로그아웃
            </button>
          </span>
        )}
      </div>

      {user && (
        <div className="absolute bottom-7 right-5 z-20 flex items-end gap-2">
          <StatsPanel
            refreshKey={`${job?.id ?? ''}:${job?.status ?? ''}:${job?.attempts.length ?? 0}`}
            open={openPanel === 'stats'}
            onToggle={() => togglePanel('stats')}
          />
          <JobHistory
            currentJobId={job?.id ?? null}
            refreshKey={`${job?.id ?? ''}:${job?.status ?? ''}:${job?.attempts.length ?? 0}`}
            onOpen={openJob}
            open={openPanel === 'history'}
            onToggle={() => togglePanel('history')}
          />
        </div>
      )}

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
        onInit={setFlow}
        minZoom={0.2}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.08 }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--grid)" gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
    </div>
  );
}
