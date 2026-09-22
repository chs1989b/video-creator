export type JobSegment = {
  index: number;
  path: string;
  startSeconds: number;
  endSeconds: number;
  status: 'pending' | 'done' | 'failed';
  resultPath: string | null;
  error?: string;
};

export type Job = {
  id: string;
  youtubeUrl: string;
  characterImagePaths: string[];
  productImagePaths: string[];
  status: 'pending' | 'downloading' | 'segmenting' | 'generating' | 'merging' | 'done' | 'failed';
  segments: JobSegment[];
  resultPath: string | null;
  createdAt: string;
  error?: string;
};

const DEFAULT_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WORKER_URL) || 'http://localhost:4000';

type ClientOptions = { baseUrl?: string; fetchFn?: typeof fetch };

export async function createJob(
  youtubeUrl: string,
  characterImage: File,
  productImage: File | null,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  const form = new FormData();
  form.append('youtubeUrl', youtubeUrl);
  form.append('characterImages', characterImage);
  if (productImage) {
    form.append('productImages', productImage);
  }

  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/jobs`, { method: 'POST', body: form });
  } catch {
    throw new Error('워커 서버에 연결할 수 없습니다. worker가 실행 중인지 확인해주세요.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `작업 생성 실패 (status ${res.status})`);
  }
  return res.json();
}

export async function getJob(
  id: string,
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<Job> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/jobs/${id}`);
  } catch {
    throw new Error('워커 서버에 연결할 수 없습니다. worker가 실행 중인지 확인해주세요.');
  }
  if (!res.ok) {
    throw new Error(`작업 조회 실패: ${id} (status ${res.status})`);
  }
  return res.json();
}

export function resultUrl(jobId: string, { baseUrl = DEFAULT_BASE_URL }: { baseUrl?: string } = {}): string {
  return `${baseUrl}/jobs/${jobId}/result`;
}
