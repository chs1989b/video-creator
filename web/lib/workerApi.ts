export type JobSegment = {
  index: number;
  path: string;
  startSeconds: number;
  endSeconds: number;
  status: 'pending' | 'done' | 'failed';
  resultPath: string | null;
  error?: string | null;
};

export type StageName = 'generate' | 'merge' | 'restyle' | 'edit' | 'voiceover';
export const STAGE_ORDER: StageName[] = ['generate', 'merge', 'restyle', 'edit', 'voiceover'];

export type StageState = {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  outputPath: string | null;
  error: string | null;
};

export type Verdict = 'approve' | 'reject';

export type Attempt = {
  id: string;
  n: number;
  kind: 'preview';
  prompt: string | null;
  characterImagePath: string;
  productImagePath: string | null;
  segmentIndex: number;
  status: 'running' | 'done' | 'failed';
  outputPath: string | null;
  estimatedCredits: number;
  credits: number | null;
  verdict: Verdict | null;
  reasons: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type JobTotals = { previews: number; credits: number; krw: number };

export const REJECT_REASONS = ['얼굴', '제품', '동작', '배경', '기타'] as const;
/** 5 seconds x 7 credits per second (ad_multiplier). */
export const PREVIEW_CREDITS = 35;

export type Job = {
  id: string;
  youtubeUrl: string;
  characterImagePaths: string[];
  productImagePaths: string[];
  script: string | null;
  restylePrompt: string | null;
  editPrompt: string | null;
  status: 'idle' | 'running' | 'done' | 'failed';
  currentStage: StageName | 'preview' | null;
  stages: Record<StageName, StageState>;
  segments: JobSegment[];
  resultPath: string | null;
  error: string | null;
  createdAt: string;
  previewRequired: boolean;
  previewLimit: number;
  attempts: Attempt[];
  approvedAttemptId: string | null;
  totals?: JobTotals;
};

const DEFAULT_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WORKER_URL) || 'http://localhost:4000';

type ClientOptions = { baseUrl?: string; fetchFn?: typeof fetch };

const CONNECT_ERROR = '워커 서버에 연결할 수 없습니다. worker가 실행 중인지 확인해주세요.';

async function request(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  failMessage: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new Error(CONNECT_ERROR);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `${failMessage} (status ${res.status})`);
  }
  return res;
}

export type CreateJobInput = {
  youtubeUrl: string;
  characterImage: File;
  productImage?: File | null;
  script?: string | null;
  restylePrompt?: string | null;
  editPrompt?: string | null;
  /** false = create only; stages are then started one by one. */
  autorun?: boolean;
  /** true = the job starts with 5-second previews that must be approved. */
  preview?: boolean;
};

export async function createJob(
  {
    youtubeUrl,
    characterImage,
    productImage = null,
    script = null,
    restylePrompt = null,
    editPrompt = null,
    autorun = true,
    preview = false,
  }: CreateJobInput,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  const form = new FormData();
  form.append('youtubeUrl', youtubeUrl);
  form.append('characterImages', characterImage);
  if (productImage) {
    form.append('productImages', productImage);
  }
  const texts: Array<[string, string | null]> = [
    ['script', script],
    ['restylePrompt', restylePrompt],
    ['editPrompt', editPrompt],
  ];
  for (const [field, value] of texts) {
    if (value && value.trim()) {
      form.append(field, value.trim());
    }
  }
  if (!autorun) {
    form.append('autorun', 'false');
  }
  if (preview) {
    form.append('preview', 'true');
  }
  const res = await request(`${baseUrl}/jobs`, { method: 'POST', body: form }, fetchFn, '작업 생성 실패');
  return res.json();
}

export async function getJob(
  id: string,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  const res = await request(`${baseUrl}/jobs/${id}`, {}, fetchFn, `작업 조회 실패: ${id}`);
  return res.json();
}

/** Resume: run every stage that is not done yet. */
export async function runJob(
  id: string,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<void> {
  await request(`${baseUrl}/jobs/${id}/run`, { method: 'POST' }, fetchFn, '이어서 실행 실패');
}

/** Step: run exactly one stage. */
export async function runStage(
  id: string,
  stage: StageName,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<void> {
  await request(`${baseUrl}/jobs/${id}/stages/${stage}/run`, { method: 'POST' }, fetchFn, '단계 실행 실패');
}

export function resultUrl(jobId: string, { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {}): string {
  return `${baseUrl}/jobs/${jobId}/result`;
}

export function stageOutputUrl(
  jobId: string,
  stage: StageName,
  { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {},
): string {
  return `${baseUrl}/jobs/${jobId}/stages/${stage}/output`;
}

/** Failed previews are refunded and do not count toward the limit (same rule as the worker). */
export function usedPreviews(job: Job): number {
  return job.attempts.filter((a) => a.status !== 'failed').length;
}

export type PreviewInput = {
  prompt?: string | null;
  /** A different person photo for this attempt only (the job keeps the one it was created with). */
  characterImage?: File | null;
  productImage?: File | null;
};

export async function runPreview(
  id: string,
  { prompt = null, characterImage = null, productImage = null }: PreviewInput = {},
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<void> {
  const form = new FormData();
  if (prompt && prompt.trim()) form.append('prompt', prompt.trim());
  if (characterImage) form.append('characterImages', characterImage);
  if (productImage) form.append('productImages', productImage);
  await request(`${baseUrl}/jobs/${id}/previews`, { method: 'POST', body: form }, fetchFn, '미리보기 실행 실패');
}

export async function sendVerdict(
  id: string,
  attemptId: string,
  verdict: Verdict,
  reasons: string[] = [],
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  const res = await request(
    `${baseUrl}/jobs/${id}/attempts/${attemptId}/verdict`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict, reasons }) },
    fetchFn,
    '판정 저장 실패',
  );
  return res.json();
}

export async function unlockPreview(
  id: string,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  const res = await request(`${baseUrl}/jobs/${id}/previews/unlock`, { method: 'POST' }, fetchFn, '한도 해제 실패');
  return res.json();
}

export function attemptOutputUrl(
  jobId: string,
  attemptId: string,
  { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {},
): string {
  return `${baseUrl}/jobs/${jobId}/attempts/${attemptId}/output`;
}
