import type { Job } from './workerApi';

// One line per job in the history panel.

export type HistoryRow = {
  id: string;
  shortId: string;
  status: string;
  tone: 'active' | 'done' | 'failed';
  started: string;
  finished: string;
  duration: string | null;
  cost: string;
  mock: boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');

function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function span(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

function statusOf(job: Job): Pick<HistoryRow, 'status' | 'tone'> {
  if (job.status === 'running') return { status: '진행 중', tone: 'active' };
  if (job.status === 'done') return { status: '완성', tone: 'done' };
  if (job.status === 'failed') return { status: '실패', tone: 'failed' };
  if (job.previewRequired && !job.approvedAttemptId) {
    return { status: `미리보기 ${job.totals?.previews ?? job.attempts.length}회 · 승인 전`, tone: 'active' };
  }
  return { status: job.previewRequired ? '승인됨 · 실행 전' : '실행 전', tone: 'active' };
}

export function historyRow(job: Job): HistoryRow {
  const credits = job.totals?.credits ?? 0;
  const krw = job.totals?.krw ?? 0;
  const cost = credits > 0 ? `${credits}크레딧 · 약 ${krw.toLocaleString('ko-KR')}원` : '0크레딧';
  const stopped = job.status === 'done' || job.status === 'failed';
  const finishedAt = stopped ? job.finishedAt ?? null : null;
  return {
    id: job.id,
    shortId: job.id.slice(0, 8),
    ...statusOf(job),
    started: clock(job.createdAt),
    finished: finishedAt ? clock(finishedAt) : '—',
    duration: finishedAt ? span(job.createdAt, finishedAt) : null,
    cost: job.mock && credits > 0 ? `실제였다면 ${cost}` : cost,
    mock: Boolean(job.mock),
  };
}
