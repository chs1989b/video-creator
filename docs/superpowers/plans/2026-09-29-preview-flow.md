# 5초 미리보기 흐름 (1단계-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 worker·캔버스 위에 "5초 미리보기(최대 5회) → 승인 → 나머지 구간 생성" 흐름과 시도·크레딧 기록을 더해, 30초 완성 1편을 약 350크레딧(약 21,000원)으로 만들 수 있게 한다.

**Architecture:** worker의 기존 단계(generate → merge → restyle → edit → voiceover)와 단계별 이어하기는 그대로 둔다. 다운로드·분할을 공용 함수 `ensureSegments`로 빼고, 새 모듈 `preview.js`가 첫 구간(5초)만 생성하는 미리보기와 승인/거절을 맡는다. 승인하면 미리보기 영상을 `segments[0]`에 완료로 넣기 때문에, 기존 `stageGenerate`가 완료된 구간을 건너뛰어 나머지만 만든다. 미리보기 없이 만든 잡(`previewRequired: false`)은 지금과 똑같이 동작한다.

**Tech Stack:** worker — Node.js(ESM) · Express 4 · lowdb 7 · `node:test`. web — Next.js 15 · React 19 · @xyflow/react 12 · Tailwind 3 · vitest 2. 외부 — Higgsfield CLI(`ad_multiplier`), ffmpeg.

**Spec:** `../week4/숏폼 리뷰 영상 서비스 기술 기획서.md` (2026-09-29판) — "핵심 흐름", "시도 횟수·비용 기록", "비용 제어", "5초 미리보기 검증 계획" 섹션. 이 계획은 1단계 중 **1-A(4회차 목표)**만 다룬다. 프롬프트 보정·인증·프록시·배포(1-B)는 별도 계획.

**기획서와 다르게 한 것 (의도적):** 기획서의 `prepare` 단계를 `STAGE_ORDER`에 추가하지 않고 공용 함수 `ensureSegments`로 구현한다. 단계 순서가 바뀌지 않아 예전 잡·UI·기존 테스트를 건드리지 않고 같은 효과(미리보기 전에 다운로드·분할)를 낸다.

## Global Constraints

- 플랜은 Higgsfield **Plus 고정**. 원화 환산 `CREDIT_KRW` 기본값 **60**.
- 미리보기 길이 `PREVIEW_SECONDS = 5`, 잡당 기본 한도 `PREVIEW_LIMIT = 5`. 한도 해제는 **1회씩**, 사용자 확인 후.
- 단가: `ad_multiplier` **초당 7크레딧**, `flux_3_video_edit` **10초당 15크레딧**, `text2speech_v2` **1회 0.45크레딧**.
- 실패한 생성은 Higgsfield가 자동 환불 → 기록 크레딧 0. 실패한 미리보기는 **한도에 세지 않는다**.
- 새 npm 의존성 추가 금지. worker 테스트는 `node --test`, web 테스트는 vitest.
- **테스트는 Higgsfield·ffmpeg를 실제로 호출하지 않는다**(가짜 deps/execFile). 실제 크레딧은 Task 10에서만, 실행 직전 사용자 확인.
- **git commit은 사용자가 그 순간 요청할 때만 실행한다**(프로젝트 CLAUDE.md). 각 Task의 커밋 단계는 "사용자가 요청하면"으로 읽는다.
- UI 문구는 한국어. 기존 캔버스 배치·다크/라이트 테마·"이 단계만 실행"·"이어서"·구간 재시도는 유지한다.
- 미리보기 없이 만든 잡과 기존 API(`POST /jobs`의 autorun 포함)는 지금과 똑같이 동작해야 한다.

## Review Focus

- **5초보다 짧거나 애매한 길이의 영상**(4.5초, 7초, 16초): 첫 구간이 4초 미만으로 쪼개지지 않아야 하고, 짧은 나머지는 앞 구간에 합쳐져야 한다 → Task 1 테스트.
- **실패했거나 아직 진행 중인 미리보기를 승인**하려는 경우: 거부되어야 하고 잡 상태가 바뀌지 않아야 한다 → Task 6 테스트.
- **승인 전에 "나머지 구간 생성"이나 "이어서"를 누르는 경우**: 크레딧을 쓰기 전에 409/에러로 막히고, 단계가 failed로 바뀌지 않아야 한다 → Task 5·7 테스트.
- **한도(5회)에 도달한 뒤 해제**: 정확히 1회만 더 허용되어야 하고, 실패한 미리보기는 한도에 들어가지 않아야 한다 → Task 6 테스트.
- **예전 db.json의 잡**(attempts 필드 없음): 에러 없이 열리고 미리보기 없는 잡으로 취급되어야 한다 → Task 4 테스트.

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `worker/src/pipeline/segment.js` | 원본을 구간으로 분할 | 수정: `firstSegmentSeconds` 옵션 |
| `worker/src/pipeline/generate.js` | 구간 1개 인물·제품 교체 | 수정: `prompt` 옵션 |
| `worker/src/pipeline/costs.js` | 단가표, 크레딧·원화 계산, 미리보기 상수 | **신규** |
| `worker/src/pipeline/db.js` | 잡 저장 | 수정: 미리보기 필드, 예전 잡 기본값 |
| `worker/src/pipeline/jobRunner.js` | 단계 실행 | 수정: `ensureSegments`·`resolveDeps` 공개, 승인 전 생성 차단, 프롬프트 전달, 크레딧 기록 |
| `worker/src/pipeline/preview.js` | 미리보기 실행·판정·한도 | **신규** |
| `worker/src/server.js` | HTTP API | 수정: 미리보기 라우트 5개, 승인 전 409, `totals` |
| `web/lib/workerApi.ts` | 웹 → 워커 클라이언트 | 수정: 타입·함수 추가 |
| `web/components/nodes/PreviewNode.tsx` | 미리보기 카드 | **신규** |
| `web/components/nodes/StageNode.tsx` | 단계 카드 | 수정: 승인 전 잠금, 제목 |
| `web/components/Canvas.tsx` | 캔버스 | 수정: 미리보기 노드·연결·핸들러·비용 배지 |
| `docs/session-handoff-2026-09-29.md` | 세션 인계 | **신규** (Task 10) |

---

### Task 0: 작업 브랜치

- [ ] **Step 1: 브랜치 만들기**

```bash
cd video_creator
git switch stage-resume-restyle
git switch -c preview-flow
```

- [ ] **Step 2: 시작 상태 확인**

Run: `cd worker && node --test && cd ../web && npx vitest run && npx tsc --noEmit`
Expected: worker 46 pass, web 10 pass, tsc 에러 없음

---

### Task 1: 첫 구간을 5초로 나누는 분할 옵션

**Files:**
- Modify: `worker/src/pipeline/segment.js` (`splitIntoSegments`)
- Test: `worker/test/segment.test.js`

**Interfaces:**
- Produces: `splitIntoSegments(filePath, outputDir, segmentSeconds = 10, { execFile, duration, firstSegmentSeconds } = {})` → `[{ index, path, startSeconds, endSeconds }]`. `firstSegmentSeconds`가 있으면 첫 구간만 그 길이.

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/segment.test.js` 끝에 추가)

```js
test('splitIntoSegments can cut a shorter first segment for the preview', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const segments = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile,
    duration: 30,
    firstSegmentSeconds: 5,
  });

  assert.deepEqual(
    segments.map((s) => [s.startSeconds, s.endSeconds]),
    [[0, 5], [5, 15], [15, 25], [25, 30]],
  );
  const lengthOf = (args) => args[args.indexOf('-t') + 1];
  assert.deepEqual(calls.map((c) => lengthOf(c.args)), ['5', '10', '10', '5']);
});

test('a short video with a preview cut folds the under-4-second remainder into the first segment', async () => {
  const fakeExecFile = async () => ({ stdout: '', stderr: '' });

  const sevenSeconds = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile, duration: 7, firstSegmentSeconds: 5,
  });
  assert.deepEqual(sevenSeconds.map((s) => [s.startSeconds, s.endSeconds]), [[0, 7]]);

  const sixteenSeconds = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile, duration: 16, firstSegmentSeconds: 5,
  });
  assert.deepEqual(sixteenSeconds.map((s) => [s.startSeconds, s.endSeconds]), [[0, 5], [5, 16]]);

  const underFive = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile, duration: 4.5, firstSegmentSeconds: 5,
  });
  assert.deepEqual(underFive.map((s) => [s.startSeconds, s.endSeconds]), [[0, 4.5]]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/segment.test.js`
Expected: 새 테스트 2개 FAIL (구간이 [0,10],[10,20]… 로 나옴)

- [ ] **Step 3: 구현** — `segment.js`의 시그니처와 구간 계산 루프를 바꾼다

```js
export async function splitIntoSegments(
  filePath,
  outputDir,
  segmentSeconds = 10,
  { execFile = defaultExecFile, duration, firstSegmentSeconds } = {},
) {
  const totalDuration = duration ?? (await getDuration(filePath, { execFile }));

  // ...(기존 주석 유지)...
  // The preview flow cuts a shorter first segment (firstSegmentSeconds) so a
  // cheap preview of it can be generated and, once approved, reused as-is.
  const chunks = [];
  let start = 0;
  while (start < totalDuration - 1e-6) {
    const size = chunks.length === 0 && firstSegmentSeconds ? firstSegmentSeconds : segmentSeconds;
    const length = Math.min(size, totalDuration - start);
    chunks.push({ start, length });
    start += length;
  }
```

(이 아래의 "4초 미만 나머지 합치기" 블록과 ffmpeg 루프는 그대로 둔다.)

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test test/segment.test.js`
Expected: 전부 PASS (기존 테스트 포함)

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/segment.js worker/test/segment.test.js
git commit -m "feat(worker): allow a shorter first segment for the preview"
```

---

### Task 2: 생성 프롬프트를 인자로 받기

**Files:**
- Modify: `worker/src/pipeline/generate.js` (`generateFromSegment`)
- Test: `worker/test/generate.test.js`

**Interfaces:**
- Produces: `generateFromSegment(segmentPath, characterImagePath, outputPath, { execFile, productImagePath, prompt })`. `prompt`가 `null`/`undefined`면 지금의 기본 문구(`FACE_SWAP_PROMPT` 또는 `FACE_AND_PRODUCT_SWAP_PROMPT`)를 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/generate.test.js` 끝에 추가)

```js
test('generateFromSegment sends a caller-supplied prompt instead of the default wording', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield') {
      return { stdout: JSON.stringify([{ id: 'job-p', status: 'completed', result_url: 'https://example.com/p.mp4' }]), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  await generateFromSegment('/tmp/j/segment-000.mp4', '/tmp/j/char.png', '/tmp/j/preview-1.mp4', {
    execFile: fakeExecFile,
    prompt: 'Replace the person with the reference; keep her smile.',
  });

  const hf = calls.find((c) => c.command === 'higgsfield');
  assert.equal(hf.args[hf.args.indexOf('--prompt') + 1], 'Replace the person with the reference; keep her smile.');
});

test('generateFromSegment falls back to the default prompt when none is given', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield') {
      return { stdout: JSON.stringify([{ id: 'job-d', status: 'completed', result_url: 'https://example.com/d.mp4' }]), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  await generateFromSegment('/tmp/j/segment-000.mp4', '/tmp/j/char.png', '/tmp/j/out.mp4', { execFile: fakeExecFile, prompt: null });

  const hf = calls.find((c) => c.command === 'higgsfield');
  assert.match(hf.args[hf.args.indexOf('--prompt') + 1], /Replace the person in the video/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/generate.test.js`
Expected: 첫 새 테스트 FAIL (기본 문구가 나감)

- [ ] **Step 3: 구현** — 옵션에 `prompt`를 추가하고 기본 문구 선택을 바꾼다

```js
export async function generateFromSegment(
  segmentPath,
  characterImagePath,
  outputPath,
  { execFile = defaultExecFile, productImagePath, prompt } = {},
) {
```

```js
  // A preview may carry its own wording; otherwise use the tested defaults.
  const finalPrompt = prompt ?? (productImagePath ? FACE_AND_PRODUCT_SWAP_PROMPT : FACE_SWAP_PROMPT);
```

그리고 `'--prompt', prompt,` 를 `'--prompt', finalPrompt,` 로 바꾼다 (기존 `const prompt = …` 줄은 삭제).

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test test/generate.test.js`
Expected: 전부 PASS

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/generate.js worker/test/generate.test.js
git commit -m "feat(worker): let callers pass their own generation prompt"
```

---

### Task 3: 단가표와 크레딧 계산 (`costs.js`)

**Files:**
- Create: `worker/src/pipeline/costs.js`
- Test: `worker/test/costs.test.js`

**Interfaces:**
- Produces:
  - 상수 `CREDIT_KRW`(60), `PREVIEW_SECONDS`(5), `PREVIEW_LIMIT`(5), `RATES`
  - `estimateCredits(model, { seconds }) → number`
  - `segmentSeconds(segment) → number`, `videoSeconds(job) → number`
  - `PRICED_STAGES = ['restyle', 'edit', 'voiceover']`, `stageCredits(job, stage) → number`
  - `toKrw(credits) → number`
  - `jobTotals(job) → { previews, credits, krw }`
  - `estimateRemaining(job) → { items: [{ stage, credits }], credits, krw }`

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/costs.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREDIT_KRW, PREVIEW_SECONDS, PREVIEW_LIMIT,
  estimateCredits, segmentSeconds, videoSeconds, stageCredits, toKrw, jobTotals, estimateRemaining,
} from '../src/pipeline/costs.js';

const seg = (index, startSeconds, endSeconds, extra = {}) => ({ index, startSeconds, endSeconds, status: 'pending', ...extra });
const stage = (status, extra = {}) => ({ status, outputPath: null, error: null, ...extra });

test('constants match the Plus plan and the 5-second, 5-attempt preview policy', () => {
  assert.equal(CREDIT_KRW, 60);
  assert.equal(PREVIEW_SECONDS, 5);
  assert.equal(PREVIEW_LIMIT, 5);
});

test('estimateCredits prices each model by its unit', () => {
  assert.equal(estimateCredits('ad_multiplier', { seconds: 5 }), 35);
  assert.equal(estimateCredits('ad_multiplier', { seconds: 10 }), 70);
  assert.equal(estimateCredits('flux_3_video_edit', { seconds: 15 }), 30);
  assert.equal(estimateCredits('text2speech_v2'), 0.45);
});

test('segment and video seconds come from the segment boundaries', () => {
  const job = { segments: [seg(0, 0, 5), seg(1, 5, 15), seg(2, 15, 30)] };
  assert.equal(segmentSeconds(job.segments[1]), 10);
  assert.equal(videoSeconds(job), 30);
  assert.equal(videoSeconds({ segments: [] }), 0);
  assert.equal(stageCredits(job, 'restyle'), 45);
  assert.equal(stageCredits(job, 'voiceover'), 0.45);
});

test('jobTotals adds previews, generated segments and finishing stages without double-counting the approved preview', () => {
  const job = {
    attempts: [{ credits: 35 }, { credits: 0 }, { credits: 35 }],
    segments: [seg(0, 0, 5, { credits: 0, fromAttemptId: 'a3' }), seg(1, 5, 15, { credits: 70 }), seg(2, 15, 25, { credits: 70 }), seg(3, 25, 30, { credits: 35 })],
    stages: { generate: stage('done'), merge: stage('done'), restyle: stage('done', { credits: 45 }), edit: stage('skipped'), voiceover: stage('done', { credits: 0.45 }) },
  };
  assert.deepEqual(jobTotals(job), { previews: 3, credits: 290.45, krw: 17427 });
  assert.equal(toKrw(350), 21000);
});

test('estimateRemaining prices only what has not run yet', () => {
  const job = {
    segments: [seg(0, 0, 5, { status: 'done' }), seg(1, 5, 15), seg(2, 15, 30)],
    stages: { generate: stage('pending'), merge: stage('pending'), restyle: stage('pending'), edit: stage('skipped'), voiceover: stage('pending') },
  };
  const estimate = estimateRemaining(job);
  assert.deepEqual(estimate.items, [
    { stage: 'generate', credits: 175 },
    { stage: 'restyle', credits: 45 },
    { stage: 'voiceover', credits: 0.45 },
  ]);
  assert.equal(estimate.credits, 220.45);
  assert.equal(estimate.krw, 13227);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/costs.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline/costs.js'`

- [ ] **Step 3: 구현** (`worker/src/pipeline/costs.js`)

```js
// One place for every price and preview policy. Values come from real runs
// (docs/higgsfield-cli-notes.md): ad_multiplier billed 70 for 10 s and 49.28
// for 7.04 s (7 per second); FLUX edit is quoted 15 per 10 s; TTS charged 0.45.
// Where a quote and a charge differ we keep the higher number, so what the
// screen promises is never less than what gets spent.
export const CREDIT_KRW = Number(process.env.CREDIT_KRW ?? 60); // Plus plan
export const PREVIEW_SECONDS = 5;
export const PREVIEW_LIMIT = 5;

export const RATES = {
  ad_multiplier: { perSecond: 7 },
  flux_3_video_edit: { perTenSeconds: 15 },
  text2speech_v2: { perCall: 0.45 },
};

const round2 = (n) => Math.round(n * 100) / 100;

export function estimateCredits(model, { seconds = 0 } = {}) {
  const rate = RATES[model];
  if (!rate) throw new Error(`Unknown model: ${model}`);
  if (rate.perSecond) return round2(rate.perSecond * seconds);
  if (rate.perTenSeconds) return rate.perTenSeconds * Math.ceil(seconds / 10);
  return rate.perCall;
}

export function segmentSeconds(segment) {
  return segment.endSeconds - segment.startSeconds;
}

export function videoSeconds(job) {
  return job.segments.length ? Math.max(...job.segments.map((s) => s.endSeconds)) : 0;
}

export const PRICED_STAGES = ['restyle', 'edit', 'voiceover'];
const STAGE_MODEL = { restyle: 'flux_3_video_edit', edit: 'flux_3_video_edit', voiceover: 'text2speech_v2' };

export function stageCredits(job, stage) {
  return estimateCredits(STAGE_MODEL[stage], { seconds: videoSeconds(job) });
}

export function toKrw(credits) {
  return Math.round(credits * CREDIT_KRW);
}

export function jobTotals(job) {
  const attempts = job.attempts ?? [];
  const previewCredits = attempts.reduce((sum, a) => sum + (a.credits ?? 0), 0);
  const segmentCredits = job.segments.reduce((sum, s) => sum + (s.credits ?? 0), 0);
  const finishing = PRICED_STAGES.reduce((sum, s) => sum + (job.stages?.[s]?.credits ?? 0), 0);
  const credits = round2(previewCredits + segmentCredits + finishing);
  return { previews: attempts.length, credits, krw: toKrw(credits) };
}

export function estimateRemaining(job) {
  const items = [];
  const pending = job.segments.filter((s) => s.status !== 'done');
  if (job.stages.generate.status !== 'done' && pending.length > 0) {
    const seconds = pending.reduce((sum, s) => sum + segmentSeconds(s), 0);
    items.push({ stage: 'generate', credits: estimateCredits('ad_multiplier', { seconds }) });
  }
  for (const stage of PRICED_STAGES) {
    if (['pending', 'failed'].includes(job.stages[stage]?.status)) {
      items.push({ stage, credits: stageCredits(job, stage) });
    }
  }
  const credits = round2(items.reduce((sum, i) => sum + i.credits, 0));
  return { items, credits, krw: toKrw(credits) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test test/costs.test.js`
Expected: 5 PASS

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/costs.js worker/test/costs.test.js
git commit -m "feat(worker): add the credit price table and cost estimates"
```

---

### Task 4: 잡에 미리보기 필드 추가, 예전 잡 호환

**Files:**
- Modify: `worker/src/pipeline/db.js` (`createJob`, `normalizeJob`)
- Test: `worker/test/db.test.js`

**Interfaces:**
- Consumes: `PREVIEW_LIMIT` (Task 3)
- Produces: `createJob(db, { ..., previewRequired = false })`. 모든 잡(새 잡·예전 잡)이 읽힐 때 다음 필드를 가진다: `previewRequired: boolean`, `previewLimit: number`, `attempts: Attempt[]`, `approvedAttemptId: string | null`, `generatePrompt: string | null`.
- `Attempt` 모양(Task 6에서 만듦): `{ id, n, kind: 'preview', prompt, characterImagePath, productImagePath, segmentIndex, status: 'running'|'done'|'failed', outputPath, estimatedCredits, credits, verdict: 'approve'|'reject'|null, reasons: string[], error, createdAt, finishedAt }`

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/db.test.js` 끝에 추가)

```js
test('createJob with previewRequired starts with an empty attempt list and the default limit', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-preview-'));
  const db = createDb(path.join(tmpDir, 'db.json'));

  const job = await createJob(db, {
    id: 'job-p', youtubeUrl: 'https://example.com/v.mp4', characterImagePaths: ['/tmp/c.png'], previewRequired: true,
  });

  assert.equal(job.previewRequired, true);
  assert.equal(job.previewLimit, 5);
  assert.deepEqual(job.attempts, []);
  assert.equal(job.approvedAttemptId, null);
  assert.equal(job.generatePrompt, null);
});

test('jobs saved before the preview flow load with preview defaults', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-legacy-preview-'));
  const dbPath = path.join(tmpDir, 'db.json');
  const stage = (status, outputPath = null) => ({ status, outputPath, error: null });
  const legacy = {
    id: 'old-1', youtubeUrl: 'https://example.com/v.mp4', characterImagePaths: ['/tmp/c.png'], productImagePaths: [],
    script: null, restylePrompt: null, editPrompt: null, status: 'done', currentStage: null,
    stages: { generate: stage('done'), merge: stage('done', '/tmp/m.mp4'), restyle: stage('skipped'), edit: stage('skipped'), voiceover: stage('skipped') },
    segments: [], resultPath: '/tmp/m.mp4', error: null, createdAt: '2026-09-24T00:00:00.000Z',
  };
  await fs.writeFile(dbPath, JSON.stringify({ jobs: [legacy] }));
  const db = createDb(dbPath);

  const job = await getJob(db, 'old-1');

  assert.equal(job.status, 'done');
  assert.equal(job.previewRequired, false);
  assert.equal(job.previewLimit, 5);
  assert.deepEqual(job.attempts, []);
  assert.equal(job.approvedAttemptId, null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/db.test.js`
Expected: 새 테스트 2개 FAIL (`previewRequired` undefined)

- [ ] **Step 3: 구현** (`db.js`)

맨 위 import에 추가:

```js
import { PREVIEW_LIMIT } from './costs.js';
```

`createJob`의 인자 목록에 `previewRequired = false,` 를 추가하고, `job` 객체에 필드를 추가:

```js
      previewRequired,
      previewLimit: PREVIEW_LIMIT,
      attempts: [],
      approvedAttemptId: null,
      generatePrompt: null,
```

`normalizeJob`을 다음처럼 바꾼다 (기존 legacy 처리 로직은 그대로, 두 반환 지점 모두 기본값을 입힘):

```js
// Jobs written before the preview flow carry no preview fields; they behave
// exactly as before (no preview required).
function withPreviewDefaults(job) {
  return { previewRequired: false, previewLimit: PREVIEW_LIMIT, attempts: [], approvedAttemptId: null, generatePrompt: null, ...job };
}

function normalizeJob(job) {
  if (job.stages) return withPreviewDefaults(job);
  // ...(기존 코드 그대로)...
  return withPreviewDefaults({
    ...job,
    stages,
    currentStage: null,
    status: legacyDone ? 'done' : job.status === 'failed' || job.error ? 'failed' : 'idle',
    error: job.error ?? null,
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test`
Expected: 전부 PASS (기존 46 + 새 테스트)

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/db.js worker/test/db.test.js
git commit -m "feat(worker): store preview attempts on the job and default old jobs"
```

---

### Task 5: 러너 — 분할 공용화, 승인 전 생성 차단, 프롬프트 전달, 크레딧 기록

**Files:**
- Modify: `worker/src/pipeline/jobRunner.js`
- Test: `worker/test/jobRunner.test.js`

**Interfaces:**
- Consumes: `splitIntoSegments(..., { firstSegmentSeconds })` (Task 1), `generateFromSegment(..., { prompt })` (Task 2), `PREVIEW_SECONDS`·`estimateCredits`·`segmentSeconds`·`PRICED_STAGES`·`stageCredits` (Task 3), 잡 필드 (Task 4)
- Produces:
  - `export function resolveDeps(deps = {})`
  - `export async function ensureSegments(db, jobId, workDir, d)` → 구간이 있는 잡. 구간이 없을 때만 다운로드·분할. `previewRequired`면 첫 구간 5초.
  - `export const APPROVAL_REQUIRED = 'approve a preview before generating the remaining segments'`
  - 세그먼트에 `credits` 기록, 가격이 있는 단계(`restyle`/`edit`/`voiceover`)에 `credits` 기록

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/jobRunner.test.js`)

import 줄을 다음으로 바꾼다:

```js
import { createDb, createJob, getJob, updateJob } from '../src/pipeline/db.js';
import { runJob, runStage, retrySegment, nextStage, ensureSegments, resolveDeps } from '../src/pipeline/jobRunner.js';
```

파일 끝에 추가:

```js
test('a preview job refuses to generate before a preview is approved, without touching its state', async () => {
  const { db, tmpDir } = await setup({ previewRequired: true });

  await assert.rejects(runStage(db, 'job-1', tmpDir, 'generate', happyDeps()), /approve a preview/);
  await assert.rejects(runJob(db, 'job-1', tmpDir, happyDeps()), /approve a preview/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
  assert.equal(job.stages.generate.status, 'pending');
});

test('ensureSegments splits a preview job once, with a 5-second first segment', async () => {
  const { db, tmpDir } = await setup({ previewRequired: true });
  const splitCalls = [];
  const d = resolveDeps(happyDeps({
    splitIntoSegments: async (_src, _dir, size, opts) => { splitCalls.push({ size, opts }); return twoSegments(); },
  }));

  await ensureSegments(db, 'job-1', tmpDir, d);
  await ensureSegments(db, 'job-1', tmpDir, d);

  assert.deepEqual(splitCalls, [{ size: 10, opts: { firstSegmentSeconds: 5 } }]);
  const job = await getJob(db, 'job-1');
  assert.equal(job.segments.length, 2);
  assert.equal(job.segments[0].status, 'pending');
});

test('generate passes the approved prompt through and records each segment\'s credits', async () => {
  const { db, tmpDir } = await setup();
  await updateJob(db, 'job-1', { generatePrompt: 'Swap the face carefully.' });
  const prompts = [];
  const deps = happyDeps({
    generateFromSegment: async (_s, _c, outputPath, opts) => { prompts.push(opts.prompt); return { outputPath }; },
  });

  await runStage(db, 'job-1', tmpDir, 'generate', deps);

  assert.deepEqual(prompts, ['Swap the face carefully.', 'Swap the face carefully.']);
  const job = await getJob(db, 'job-1');
  assert.deepEqual(job.segments.map((s) => s.credits), [70, 35]);
});

test('finishing stages record their estimated credits', async () => {
  const { db, tmpDir } = await setup({ restylePrompt: 'Beige shirt.', script: 'Hi.' });

  await runJob(db, 'job-1', tmpDir, happyDeps());

  const job = await getJob(db, 'job-1');
  assert.equal(job.stages.restyle.credits, 30); // 15-second video -> 2 x 15
  assert.equal(job.stages.voiceover.credits, 0.45);
  assert.equal(job.stages.edit.credits ?? null, null); // skipped: nothing spent
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/jobRunner.test.js`
Expected: 새 테스트 FAIL (`ensureSegments` is not a function 등)

- [ ] **Step 3: 구현** (`jobRunner.js`)

import에 추가:

```js
import { PREVIEW_SECONDS, estimateCredits, segmentSeconds, PRICED_STAGES, stageCredits } from './costs.js';
```

`function resolveDeps(deps)` 를 `export function resolveDeps(deps = {})` 로 바꾼다.

`setSegmentStatus`에 크레딧을 받게 한다:

```js
async function setSegmentStatus(db, jobId, index, status, resultPath, error, credits = null) {
  const job = await requireJob(db, jobId);
  const segment = job.segments.find((s) => s.index === index);
  segment.status = status;
  segment.resultPath = resultPath;
  segment.error = error ?? null;
  segment.credits = credits;
  await updateJob(db, jobId, { segments: job.segments });
}
```

`// --- stage bodies ---` 바로 위에 추가:

```js
export const APPROVAL_REQUIRED = 'approve a preview before generating the remaining segments';

const generateCredits = (segment) => estimateCredits('ad_multiplier', { seconds: segmentSeconds(segment) });

/** Download and split only once; a resumed job keeps its segments. Shared by generate and preview. */
export async function ensureSegments(db, jobId, workDir, d) {
  const job = await requireJob(db, jobId);
  if (job.segments.length > 0) return job;
  const { filePath: sourcePath } = await d.downloadVideo(job.youtubeUrl, workDir);
  const options = job.previewRequired ? { firstSegmentSeconds: PREVIEW_SECONDS } : {};
  const segments = await d.splitIntoSegments(sourcePath, workDir, 10, options);
  await updateJob(db, jobId, {
    segments: segments.map((s) => ({ ...s, status: 'pending', resultPath: null, error: null, credits: null })),
  });
  return requireJob(db, jobId);
}
```

`stageGenerate`를 다음으로 바꾼다:

```js
async function stageGenerate(db, jobId, workDir, d) {
  const job = await ensureSegments(db, jobId, workDir, d);

  let failed = 0;
  for (const segment of job.segments) {
    if (segment.status === 'done') continue;
    const outputPath = path.join(workDir, `generated-${segment.index}.mp4`);
    try {
      await d.generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
        productImagePath: job.productImagePaths?.[0],
        prompt: job.generatePrompt,
      });
      await setSegmentStatus(db, jobId, segment.index, 'done', outputPath, null, generateCredits(segment));
    } catch (error) {
      failed += 1;
      // Failed generations are refunded by Higgsfield, so they cost nothing.
      await setSegmentStatus(db, jobId, segment.index, 'failed', null, error.message, 0);
      // Keep going: each segment is billed on its own, and only the failed
      // ones need to run again next time.
    }
  }
  if (failed > 0) throw new Error(`${failed} segment(s) failed to generate`);
  return null;
}
```

`runStage`에서 `if (!previousStageDone(job, stage)) throw …` 줄 바로 아래에 추가 (잡 상태를 바꾸기 **전**에 막는다):

```js
  if (stage === 'generate' && job.previewRequired && !job.approvedAttemptId) {
    throw new Error(APPROVAL_REQUIRED);
  }
```

`runStage`의 성공 기록 줄 `await setStage(db, jobId, stage, { status: 'done', outputPath, error: null });` 을 다음으로 바꾼다:

```js
    const patch = { status: 'done', outputPath, error: null };
    if (PRICED_STAGES.includes(stage)) patch.credits = stageCredits(await requireJob(db, jobId), stage);
    await setStage(db, jobId, stage, patch);
```

`retrySegment`의 생성 호출과 상태 기록을 다음으로 바꾼다:

```js
    await d.generateFromSegment(segment.path, job.characterImagePaths[0], outputPath, {
      productImagePath: job.productImagePaths?.[0],
      prompt: job.generatePrompt,
    });
    await setSegmentStatus(db, jobId, segmentIndex, 'done', outputPath, null, generateCredits(segment));
  } catch (error) {
    await setSegmentStatus(db, jobId, segmentIndex, 'failed', null, error.message, 0);
```

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test`
Expected: 전부 PASS (기존 테스트 포함 — 미리보기 없는 잡은 동작이 같아야 함)

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/jobRunner.js worker/test/jobRunner.test.js
git commit -m "feat(worker): gate generation on an approved preview and record credits"
```

---

### Task 6: 미리보기 실행·판정·한도 (`preview.js`)

**Files:**
- Create: `worker/src/pipeline/preview.js`
- Test: `worker/test/preview.test.js`

**Interfaces:**
- Consumes: `ensureSegments`, `resolveDeps` (Task 5), `estimateCredits`, `segmentSeconds` (Task 3), `getJob`, `updateJob` (db)
- Produces:
  - `usedPreviews(job) → number` (실패 제외)
  - `previewBlocker(job) → string | null` (미리보기를 못 하는 이유)
  - `runPreview(db, jobId, workDir, { prompt, characterImagePath, productImagePath } = {}, deps = {}) → Attempt`
  - `recordVerdict(db, jobId, attemptId, { verdict: 'approve'|'reject', reasons = [] }) → Job`
  - `unlockPreview(db, jobId) → Job`
  - 미리보기 결과 파일: `<workDir>/preview-<n>.mp4`, 시도 id: `a<n>`

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/preview.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob } from '../src/pipeline/db.js';
import { runStage } from '../src/pipeline/jobRunner.js';
import { runPreview, recordVerdict, unlockPreview, previewBlocker, usedPreviews } from '../src/pipeline/preview.js';

async function setup(extra = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-1', youtubeUrl: 'https://example.com/v.mp4', characterImagePaths: ['/tmp/char.png'],
    productImagePaths: ['/tmp/product.png'], previewRequired: true, ...extra,
  });
  return { db, tmpDir };
}

const threeSegments = async () => [
  { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 5 },
  { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 5, endSeconds: 15 },
  { index: 2, path: '/tmp/segment-002.mp4', startSeconds: 15, endSeconds: 25 },
];

function deps(generated = [], overrides = {}) {
  return {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: threeSegments,
    generateFromSegment: async (segmentPath, characterImagePath, outputPath, opts) => {
      generated.push({ segmentPath, characterImagePath, outputPath, ...opts });
      return { outputPath };
    },
    ...overrides,
  };
}

test('runPreview generates only the first 5-second segment and records the attempt', async () => {
  const { db, tmpDir } = await setup();
  const generated = [];

  const attempt = await runPreview(db, 'job-1', tmpDir, { prompt: 'Keep her smile.' }, deps(generated));

  assert.equal(generated.length, 1);
  assert.equal(generated[0].segmentPath, '/tmp/segment-000.mp4');
  assert.equal(generated[0].outputPath, path.join(tmpDir, 'preview-1.mp4'));
  assert.equal(generated[0].prompt, 'Keep her smile.');
  assert.equal(generated[0].productImagePath, '/tmp/product.png');
  assert.equal(attempt.id, 'a1');
  assert.equal(attempt.status, 'done');
  assert.equal(attempt.credits, 35);
  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
  assert.equal(job.attempts.length, 1);
  assert.equal(job.segments[0].status, 'pending'); // not reused until approved
});

test('a preview can use a different person photo than the job was created with', async () => {
  const { db, tmpDir } = await setup();
  const generated = [];

  await runPreview(db, 'job-1', tmpDir, { characterImagePath: '/tmp/other.png' }, deps(generated));

  assert.equal(generated[0].characterImagePath, '/tmp/other.png');
  const job = await getJob(db, 'job-1');
  assert.equal(job.attempts[0].characterImagePath, '/tmp/other.png');
});

test('a failed preview costs nothing, marks the job failed, and does not count toward the limit', async () => {
  const { db, tmpDir } = await setup();
  const failing = deps([], { generateFromSegment: async () => { throw new Error('nsfw'); } });

  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, failing), /nsfw/);

  let job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts[0].status, 'failed');
  assert.equal(job.attempts[0].credits, 0);
  assert.equal(usedPreviews(job), 0);

  const next = await runPreview(db, 'job-1', tmpDir, {}, deps());
  assert.equal(next.n, 2);
  job = await getJob(db, 'job-1');
  assert.equal(job.status, 'idle');
});

test('the sixth preview is blocked until one more is unlocked, and only one', async () => {
  const { db, tmpDir } = await setup();
  for (let i = 0; i < 5; i += 1) {
    const a = await runPreview(db, 'job-1', tmpDir, {}, deps());
    await recordVerdict(db, 'job-1', a.id, { verdict: 'reject', reasons: ['얼굴'] });
  }

  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /limit/);
  assert.match(previewBlocker(await getJob(db, 'job-1')), /limit/);

  await unlockPreview(db, 'job-1');
  await runPreview(db, 'job-1', tmpDir, {}, deps());
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /limit/);
});

test('rejecting keeps the job unapproved and stores the reasons', async () => {
  const { db, tmpDir } = await setup();
  const a = await runPreview(db, 'job-1', tmpDir, {}, deps());

  const job = await recordVerdict(db, 'job-1', a.id, { verdict: 'reject', reasons: ['제품', '동작'] });

  assert.equal(job.approvedAttemptId, null);
  assert.equal(job.attempts[0].verdict, 'reject');
  assert.deepEqual(job.attempts[0].reasons, ['제품', '동작']);
});

test('approving reuses the preview as segment 0 and the remaining generation uses its settings', async () => {
  const { db, tmpDir } = await setup();
  await runPreview(db, 'job-1', tmpDir, { prompt: 'First try.' }, deps());
  const second = await runPreview(db, 'job-1', tmpDir, { prompt: 'Second try.', characterImagePath: '/tmp/b.png' }, deps());

  const approved = await recordVerdict(db, 'job-1', second.id, { verdict: 'approve' });

  assert.equal(approved.approvedAttemptId, 'a2');
  assert.equal(approved.generatePrompt, 'Second try.');
  assert.deepEqual(approved.characterImagePaths, ['/tmp/b.png']);
  assert.equal(approved.segments[0].status, 'done');
  assert.equal(approved.segments[0].resultPath, path.join(tmpDir, 'preview-2.mp4'));
  assert.equal(approved.segments[0].credits, 0);

  const generated = [];
  await runStage(db, 'job-1', tmpDir, 'generate', deps(generated));
  assert.deepEqual(generated.map((g) => g.segmentPath), ['/tmp/segment-001.mp4', '/tmp/segment-002.mp4']);
  assert.deepEqual(generated.map((g) => g.prompt), ['Second try.', 'Second try.']);
  assert.deepEqual(generated.map((g) => g.characterImagePath), ['/tmp/b.png', '/tmp/b.png']);
});

test('only a finished preview can be approved, only once, and no preview runs after approval', async () => {
  const { db, tmpDir } = await setup();
  await assert.rejects(
    runPreview(db, 'job-1', tmpDir, {}, deps([], { generateFromSegment: async () => { throw new Error('failed'); } })),
  );
  await assert.rejects(recordVerdict(db, 'job-1', 'a1', { verdict: 'approve' }), /finished/);
  await assert.rejects(recordVerdict(db, 'job-1', 'a9', { verdict: 'approve' }), /not found/);

  const ok = await runPreview(db, 'job-1', tmpDir, {}, deps());
  await recordVerdict(db, 'job-1', ok.id, { verdict: 'approve' });

  await assert.rejects(recordVerdict(db, 'job-1', ok.id, { verdict: 'approve' }), /already approved/);
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /already approved/);
  await assert.rejects(recordVerdict(db, 'job-1', ok.id, { verdict: 'maybe' }), /Unknown verdict/);
});

test('a job created without previews refuses preview calls', async () => {
  const { db, tmpDir } = await setup({ previewRequired: false });
  await assert.rejects(runPreview(db, 'job-1', tmpDir, {}, deps()), /does not use previews/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/preview.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline/preview.js'`

- [ ] **Step 3: 구현** (`worker/src/pipeline/preview.js`)

```js
import path from 'node:path';
import { getJob, updateJob } from './db.js';
import { ensureSegments, resolveDeps } from './jobRunner.js';
import { estimateCredits, segmentSeconds } from './costs.js';

// A preview generates only the first (5-second) segment, so the expensive
// full generation runs once, after the user approves a look. The approved
// preview becomes segment 0 as-is; stageGenerate then skips it.

async function requireJob(db, jobId) {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

async function patchAttempt(db, jobId, attemptId, patch) {
  const job = await requireJob(db, jobId);
  const attempts = job.attempts.map((a) => (a.id === attemptId ? { ...a, ...patch } : a));
  await updateJob(db, jobId, { attempts });
}

/** Failed previews are refunded and do not use up the limit. */
export function usedPreviews(job) {
  return job.attempts.filter((a) => a.status !== 'failed').length;
}

/** Why a preview cannot start right now, or null when it can. */
export function previewBlocker(job) {
  if (!job.previewRequired) return 'this job does not use previews';
  if (job.status === 'running') return 'job is already running';
  if (job.approvedAttemptId) return 'a preview is already approved; start a new job to change settings';
  if (usedPreviews(job) >= job.previewLimit) return `preview limit reached (${job.previewLimit})`;
  return null;
}

export async function runPreview(
  db,
  jobId,
  workDir,
  { prompt = null, characterImagePath = null, productImagePath = null } = {},
  deps = {},
) {
  const d = resolveDeps(deps);
  let job = await requireJob(db, jobId);
  const blocker = previewBlocker(job);
  if (blocker) throw new Error(blocker);

  await updateJob(db, jobId, { status: 'running', currentStage: 'preview', error: null });
  try {
    job = await ensureSegments(db, jobId, workDir, d);
  } catch (error) {
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }

  const segment = job.segments[0];
  const n = job.attempts.length + 1;
  const attempt = {
    id: `a${n}`,
    n,
    kind: 'preview',
    prompt,
    characterImagePath: characterImagePath ?? job.characterImagePaths[0],
    productImagePath: productImagePath ?? job.productImagePaths?.[0] ?? null,
    segmentIndex: segment.index,
    status: 'running',
    outputPath: null,
    estimatedCredits: estimateCredits('ad_multiplier', { seconds: segmentSeconds(segment) }),
    credits: null,
    verdict: null,
    reasons: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  await updateJob(db, jobId, { attempts: [...job.attempts, attempt] });

  const outputPath = path.join(workDir, `preview-${n}.mp4`);
  try {
    await d.generateFromSegment(segment.path, attempt.characterImagePath, outputPath, {
      productImagePath: attempt.productImagePath,
      prompt,
    });
    const done = { status: 'done', outputPath, credits: attempt.estimatedCredits, finishedAt: new Date().toISOString() };
    await patchAttempt(db, jobId, attempt.id, done);
    await updateJob(db, jobId, { status: 'idle', currentStage: null });
    return { ...attempt, ...done };
  } catch (error) {
    await patchAttempt(db, jobId, attempt.id, {
      status: 'failed', credits: 0, error: error.message, finishedAt: new Date().toISOString(),
    });
    await updateJob(db, jobId, { status: 'failed', currentStage: null, error: error.message });
    throw error;
  }
}

export async function recordVerdict(db, jobId, attemptId, { verdict, reasons = [] } = {}) {
  if (!['approve', 'reject'].includes(verdict)) throw new Error(`Unknown verdict: ${verdict}`);
  const job = await requireJob(db, jobId);
  if (job.status === 'running') throw new Error('job is already running');
  const attempt = job.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
  if (job.approvedAttemptId) throw new Error('a preview is already approved');
  if (attempt.status !== 'done') throw new Error('only a finished preview can be judged');

  const attempts = job.attempts.map((a) => (a.id === attemptId ? { ...a, verdict, reasons } : a));
  if (verdict === 'reject') {
    await updateJob(db, jobId, { attempts });
    return requireJob(db, jobId);
  }

  // The approved preview is segment 0, already paid for as a preview.
  const segments = job.segments.map((s) => (s.index === attempt.segmentIndex
    ? { ...s, status: 'done', resultPath: attempt.outputPath, error: null, credits: 0, fromAttemptId: attempt.id }
    : s));
  await updateJob(db, jobId, {
    attempts,
    segments,
    approvedAttemptId: attempt.id,
    characterImagePaths: [attempt.characterImagePath],
    productImagePaths: attempt.productImagePath ? [attempt.productImagePath] : [],
    generatePrompt: attempt.prompt,
    error: null,
  });
  return requireJob(db, jobId);
}

/** One more preview beyond the limit, after the user has seen the cost. */
export async function unlockPreview(db, jobId) {
  const job = await requireJob(db, jobId);
  await updateJob(db, jobId, { previewLimit: job.previewLimit + 1 });
  return requireJob(db, jobId);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test`
Expected: 전부 PASS

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/pipeline/preview.js worker/test/preview.test.js
git commit -m "feat(worker): add 5-second previews with approve/reject and a limit"
```

---

### Task 7: HTTP API — 미리보기 라우트, 승인 전 409, 비용 합계

**Files:**
- Modify: `worker/src/server.js`
- Test: `worker/test/server.test.js`

**Interfaces:**
- Consumes: `runPreview`, `recordVerdict`, `unlockPreview`, `previewBlocker` (Task 6), `nextStage`, `APPROVAL_REQUIRED` (Task 5), `jobTotals`, `estimateRemaining` (Task 3)
- Produces (HTTP):
  - `POST /jobs` 폼 필드 `preview=true` → `previewRequired: true`, autorun 하지 않음
  - 모든 잡 응답(`POST /jobs`, `GET /jobs`, `GET /jobs/:id`, 판정·해제 응답)에 `totals: { previews, credits, krw }`
  - `POST /jobs/:id/previews` (multipart, 선택: `prompt`, `characterImages`, `productImages`) → 202 / 404 / 409 `{ error }`
  - `POST /jobs/:id/attempts/:attemptId/verdict` (JSON `{ verdict, reasons }`) → 200 잡 / 404 / 409
  - `POST /jobs/:id/previews/unlock` → 200 잡 / 404
  - `GET /jobs/:id/attempts/:attemptId/output` → 영상 파일 / 404
  - `GET /jobs/:id/estimate` → `{ items, credits, krw }` / 404
  - `POST /jobs/:id/run`, `POST /jobs/:id/stages/generate/run` → 승인 전이면 409 `{ error: APPROVAL_REQUIRED }`

- [ ] **Step 1: 실패하는 테스트 작성** (`worker/test/server.test.js`)

맨 위 import에 추가:

```js
import { createDb, updateJob } from '../src/pipeline/db.js';
```

`startTestServer`를 다음으로 바꾼다 (미리보기 함수 주입 + `dataDir` 반환):

```js
async function startTestServer(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({
    dataDir,
    runJob: overrides.runJob ?? (async () => ({ resultPath: '/tmp/final.mp4' })),
    runStage: overrides.runStage ?? (async (_db, _id, _dir, stage) => ({ stage })),
    retrySegment: overrides.retrySegment ?? (async () => ({ outputPath: '/tmp/generated-0.mp4' })),
    ...(overrides.runPreview ? { runPreview: overrides.runPreview } : {}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://localhost:${port}`, dataDir };
}

async function createPreviewJob(baseUrl) {
  const form = new FormData();
  form.append('youtubeUrl', 'https://example.com/v.mp4');
  form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');
  form.append('preview', 'true');
  const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
  return { res, job: await res.json() };
}
```

파일 끝에 추가:

```js
test('POST /jobs with preview=true makes a preview job, does not autorun, and reports totals', async () => {
  let runJobCalls = 0;
  const { server, baseUrl } = await startTestServer({ runJob: async () => { runJobCalls += 1; } });
  try {
    const { res, job } = await createPreviewJob(baseUrl);
    assert.equal(res.status, 201);
    assert.equal(job.previewRequired, true);
    assert.deepEqual(job.totals, { previews: 0, credits: 0, krw: 0 });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runJobCalls, 0);

    const got = await (await fetch(`${baseUrl}/jobs/${job.id}`)).json();
    assert.deepEqual(got.totals, { previews: 0, credits: 0, krw: 0 });
  } finally {
    server.close();
  }
});

test('POST /jobs/:id/previews starts a preview with the prompt; non-preview jobs get 409', async () => {
  const calls = [];
  const { server, baseUrl } = await startTestServer({
    runPreview: async (_db, id, _dir, options) => { calls.push({ id, ...options }); },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    const form = new FormData();
    form.append('prompt', '  Keep her smile.  ');
    const res = await fetch(`${baseUrl}/jobs/${job.id}/previews`, { method: 'POST', body: form });
    assert.equal(res.status, 202);
    assert.deepEqual(calls, [{ id: job.id, prompt: 'Keep her smile.', characterImagePath: null, productImagePath: null }]);

    const plain = new FormData();
    plain.append('youtubeUrl', 'https://example.com/v.mp4');
    plain.append('characterImages', new Blob([new Uint8Array([1])]), 'c.png');
    plain.append('autorun', 'false');
    const plainJob = await (await fetch(`${baseUrl}/jobs`, { method: 'POST', body: plain })).json();
    const refused = await fetch(`${baseUrl}/jobs/${plainJob.id}/previews`, { method: 'POST', body: new FormData() });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /does not use previews/);

    const missing = await fetch(`${baseUrl}/jobs/nope/previews`, { method: 'POST', body: new FormData() });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('before approval, /run and /stages/generate/run answer 409 and start nothing', async () => {
  let started = 0;
  const { server, baseUrl } = await startTestServer({
    runJob: async () => { started += 1; },
    runStage: async () => { started += 1; },
  });
  try {
    const { job } = await createPreviewJob(baseUrl);
    const run = await fetch(`${baseUrl}/jobs/${job.id}/run`, { method: 'POST' });
    assert.equal(run.status, 409);
    assert.match((await run.json()).error, /approve a preview/);
    const stage = await fetch(`${baseUrl}/jobs/${job.id}/stages/generate/run`, { method: 'POST' });
    assert.equal(stage.status, 409);
    assert.equal(started, 0);
  } finally {
    server.close();
  }
});

test('verdict, unlock, attempt output and estimate routes', async () => {
  const { server, baseUrl, dataDir } = await startTestServer();
  try {
    const { job } = await createPreviewJob(baseUrl);
    const previewFile = path.join(dataDir, 'preview-1.mp4');
    await fs.writeFile(previewFile, 'fake-video');
    const db = createDb(path.join(dataDir, 'db.json'));
    await updateJob(db, job.id, {
      segments: [
        { index: 0, path: '/tmp/s0.mp4', startSeconds: 0, endSeconds: 5, status: 'pending', resultPath: null, error: null, credits: null },
        { index: 1, path: '/tmp/s1.mp4', startSeconds: 5, endSeconds: 15, status: 'pending', resultPath: null, error: null, credits: null },
      ],
      attempts: [{
        id: 'a1', n: 1, kind: 'preview', prompt: null, characterImagePath: '/tmp/c.png', productImagePath: null,
        segmentIndex: 0, status: 'done', outputPath: previewFile, estimatedCredits: 35, credits: 35,
        verdict: null, reasons: [], error: null, createdAt: '2026-09-29T00:00:00.000Z', finishedAt: '2026-09-29T00:01:00.000Z',
      }],
    });

    const video = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/output`);
    assert.equal(video.status, 200);
    assert.equal(await video.text(), 'fake-video');

    const unlocked = await (await fetch(`${baseUrl}/jobs/${job.id}/previews/unlock`, { method: 'POST' })).json();
    assert.equal(unlocked.previewLimit, 6);

    const verdictRes = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }),
    });
    assert.equal(verdictRes.status, 200);
    const approved = await verdictRes.json();
    assert.equal(approved.approvedAttemptId, 'a1');
    assert.deepEqual(approved.totals, { previews: 1, credits: 35, krw: 2100 });

    const again = await fetch(`${baseUrl}/jobs/${job.id}/attempts/a1/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }),
    });
    assert.equal(again.status, 409);

    const estimate = await (await fetch(`${baseUrl}/jobs/${job.id}/estimate`)).json();
    assert.deepEqual(estimate.items, [{ stage: 'generate', credits: 70 }]);
    assert.equal(estimate.krw, 4200);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd worker && node --test test/server.test.js`
Expected: 새 테스트 4개 FAIL

- [ ] **Step 3: 구현** (`server.js`)

import를 다음으로 바꾼다:

```js
import { createDb, createJob, getJob, listJobs } from './pipeline/db.js';
import {
  runJob as defaultRunJob,
  runStage as defaultRunStage,
  retrySegment as defaultRetrySegment,
  nextStage,
  APPROVAL_REQUIRED,
} from './pipeline/jobRunner.js';
import {
  runPreview as defaultRunPreview,
  recordVerdict as defaultRecordVerdict,
  unlockPreview as defaultUnlockPreview,
  previewBlocker,
} from './pipeline/preview.js';
import { jobTotals, estimateRemaining } from './pipeline/costs.js';
import { STAGE_ORDER } from './pipeline/stages.js';
```

`createApp` 인자에 추가:

```js
  runPreview = defaultRunPreview,
  recordVerdict = defaultRecordVerdict,
  unlockPreview = defaultUnlockPreview,
```

`app.use(cors());` 아래에:

```js
  app.use(express.json());

  const withTotals = (job) => ({ ...job, totals: jobTotals(job) });
  const needsApproval = (job) => job.previewRequired && !job.approvedAttemptId;
```

`POST /jobs` 안에서:

```js
    const previewRequired = req.body.preview === 'true';
    const job = await createJob(db, {
      id, youtubeUrl, characterImagePaths, productImagePaths, script, restylePrompt, editPrompt, previewRequired,
    });
```

autorun 조건을 `if (req.body.autorun !== 'false' && !previewRequired) {` 로 바꾸고, 응답을 `res.status(201).json(withTotals(job));` 로 바꾼다.

`GET /jobs` → `res.json((await listJobs(db)).map(withTotals));`
`GET /jobs/:id` → `res.json(withTotals(job));`

`POST /jobs/:id/run`의 running 검사 아래에:

```js
    if (needsApproval(job) && nextStage(job) === 'generate') {
      res.status(409).json({ error: APPROVAL_REQUIRED });
      return;
    }
```

`POST /jobs/:id/stages/:stage/run`의 running 검사 아래에:

```js
    if (stage === 'generate' && needsApproval(job)) {
      res.status(409).json({ error: APPROVAL_REQUIRED });
      return;
    }
```

`app.post('/jobs/:id/segments/:index/retry', …)` 위에 새 라우트들을 추가:

```js
  const previewUploads = upload.fields([
    { name: 'characterImages', maxCount: 1 },
    { name: 'productImages', maxCount: 1 },
  ]);

  // Preview: generate only the first (5-second) segment. Runs in the background.
  app.post('/jobs/:id/previews', previewUploads, async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const blocker = previewBlocker(job);
    if (blocker) {
      res.status(409).json({ error: blocker });
      return;
    }
    const options = {
      prompt: optionalText(req.body.prompt),
      characterImagePath: req.files?.characterImages?.[0]?.path ?? null,
      productImagePath: req.files?.productImages?.[0]?.path ?? null,
    };
    startInBackground(`Job ${job.id} preview`, runPreview(db, job.id, workDirFor(job.id), options));
    res.status(202).json({ ok: true });
  });

  app.post('/jobs/:id/previews/unlock', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(withTotals(await unlockPreview(db, job.id)));
  });

  app.post('/jobs/:id/attempts/:attemptId/verdict', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    try {
      const updated = await recordVerdict(db, job.id, req.params.attemptId, {
        verdict: req.body?.verdict,
        reasons: Array.isArray(req.body?.reasons) ? req.body.reasons : [],
      });
      res.json(withTotals(updated));
    } catch (error) {
      res.status(409).json({ error: error.message });
    }
  });

  app.get('/jobs/:id/attempts/:attemptId/output', async (req, res) => {
    const job = await getJob(db, req.params.id);
    const attempt = job?.attempts.find((a) => a.id === req.params.attemptId);
    if (!attempt?.outputPath) {
      res.status(404).json({ error: 'preview not ready' });
      return;
    }
    res.sendFile(attempt.outputPath);
  });

  app.get('/jobs/:id/estimate', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(estimateRemaining(job));
  });
```

- [ ] **Step 4: 통과 확인**

Run: `cd worker && node --test`
Expected: 전부 PASS

- [ ] **Step 5: 커밋 (사용자가 요청하면)**

```bash
git add worker/src/server.js worker/test/server.test.js
git commit -m "feat(worker): expose preview, verdict, unlock and estimate routes"
```

---

### Task 8: 웹 클라이언트 (`workerApi.ts`)

**Files:**
- Modify: `web/lib/workerApi.ts`
- Test: `web/test/workerApi.test.ts`

**Interfaces:**
- Consumes: Task 7의 HTTP API
- Produces:
  - 타입 `Attempt`, `JobTotals`, `Verdict = 'approve' | 'reject'`; `Job`에 `previewRequired`, `previewLimit`, `attempts`, `approvedAttemptId`, `totals?`, `currentStage: StageName | 'preview' | null`
  - 상수 `REJECT_REASONS = ['얼굴', '제품', '동작', '배경', '기타']`, `PREVIEW_CREDITS = 35`
  - `createJob({ ..., preview?: boolean })`
  - `runPreview(id, { prompt? }, opts) → Promise<void>`
  - `sendVerdict(id, attemptId, verdict, reasons = [], opts) → Promise<Job>`
  - `unlockPreview(id, opts) → Promise<Job>`
  - `attemptOutputUrl(jobId, attemptId, { baseUrl }) → string`
  - `usedPreviews(job) → number` (실패 제외, 워커와 같은 규칙)

- [ ] **Step 1: 실패하는 테스트 작성** (`web/test/workerApi.test.ts`)

import 줄을 다음으로 바꾼다:

```ts
import {
  createJob, getJob, runJob, runStage, resultUrl, stageOutputUrl,
  runPreview, sendVerdict, unlockPreview, attemptOutputUrl, usedPreviews, type Job,
} from '../lib/workerApi';
```

파일 끝에 추가:

```ts
test('createJob marks a preview job with preview=true', async () => {
  const { calls, fetchFn } = recordingFetch();
  await createJob(
    { youtubeUrl: 'https://example.com/v.mp4', characterImage: fakeFile('c.png'), preview: true, autorun: false },
    { baseUrl: 'http://w', fetchFn },
  );
  const body = calls[0].init.body as FormData;
  expect(body.get('preview')).toBe('true');
  expect(body.get('autorun')).toBe('false');
});

test('runPreview posts to the previews route with a trimmed prompt only when given', async () => {
  const { calls, fetchFn } = recordingFetch(202, { ok: true });
  await runPreview('job-1', { prompt: '  Keep her smile. ' }, { baseUrl: 'http://w', fetchFn });
  await runPreview('job-1', {}, { baseUrl: 'http://w', fetchFn });
  expect(calls[0].url).toBe('http://w/jobs/job-1/previews');
  expect(calls[0].init.method).toBe('POST');
  expect((calls[0].init.body as FormData).get('prompt')).toBe('Keep her smile.');
  expect((calls[1].init.body as FormData).get('prompt')).toBeNull();
});

test('sendVerdict posts JSON and returns the updated job; unlockPreview posts to unlock', async () => {
  const { calls, fetchFn } = recordingFetch(200, { id: 'job-1', approvedAttemptId: 'a2' });
  const job = await sendVerdict('job-1', 'a2', 'reject', ['얼굴'], { baseUrl: 'http://w', fetchFn });
  expect(calls[0].url).toBe('http://w/jobs/job-1/attempts/a2/verdict');
  expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ verdict: 'reject', reasons: ['얼굴'] });
  expect(job.approvedAttemptId).toBe('a2');

  await unlockPreview('job-1', { baseUrl: 'http://w', fetchFn });
  expect(calls[1].url).toBe('http://w/jobs/job-1/previews/unlock');
  expect(calls[1].init.method).toBe('POST');
});

test('attemptOutputUrl and usedPreviews', () => {
  expect(attemptOutputUrl('job-1', 'a3', { baseUrl: 'http://w' })).toBe('http://w/jobs/job-1/attempts/a3/output');
  const job = { attempts: [{ status: 'done' }, { status: 'failed' }, { status: 'running' }] } as unknown as Job;
  expect(usedPreviews(job)).toBe(2);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run`
Expected: 새 테스트 FAIL (`runPreview` is not exported 등)

- [ ] **Step 3: 구현** (`workerApi.ts`)

`Job` 타입 위에 추가:

```ts
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
```

`Job` 타입에서 `currentStage: StageName | null;` 을 `currentStage: StageName | 'preview' | null;` 로 바꾸고 다음 필드를 추가:

```ts
  previewRequired: boolean;
  previewLimit: number;
  attempts: Attempt[];
  approvedAttemptId: string | null;
  totals?: JobTotals;
```

`CreateJobInput`에 `preview?: boolean;` 추가. `createJob`의 구조분해에 `preview = false,` 를 추가하고 autorun 처리 아래에:

```ts
  if (preview) {
    form.append('preview', 'true');
  }
```

파일 끝에 추가:

```ts
/** Failed previews are refunded and do not count toward the limit (same rule as the worker). */
export function usedPreviews(job: Job): number {
  return job.attempts.filter((a) => a.status !== 'failed').length;
}

export async function runPreview(
  id: string,
  { prompt = null }: { prompt?: string | null } = {},
  { baseUrl = DEFAULT_BASE_URL, fetchFn = fetch }: ClientOptions = {},
): Promise<void> {
  const form = new FormData();
  if (prompt && prompt.trim()) form.append('prompt', prompt.trim());
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: vitest 전부 PASS. tsc는 Canvas가 새 `currentStage` 타입을 쓰는 곳에서 에러가 날 수 있음 → Task 9에서 해결 (에러가 `Canvas.tsx`/`StageNode.tsx`에만 있으면 OK).

- [ ] **Step 5: 커밋 (사용자가 요청하면, Task 9와 함께 해도 됨)**

```bash
git add web/lib/workerApi.ts web/test/workerApi.test.ts
git commit -m "feat(web): add preview, verdict and unlock calls to the worker client"
```

---

### Task 9: 캔버스 — 미리보기 노드, 승인 전 잠금, 비용 배지

**Files:**
- Create: `web/components/nodes/PreviewNode.tsx`
- Modify: `web/components/nodes/StageNode.tsx`, `web/components/Canvas.tsx`

**Interfaces:**
- Consumes: Task 8의 함수·타입
- Produces: `PreviewNodeData = { job, onRunPreview, onVerdict, onUnlock, attemptUrl, previewCredits }`, `previewAllowed(job) → boolean`, `unlockAllowed(job) → boolean`

- [ ] **Step 1: 미리보기 카드 만들기** (`web/components/nodes/PreviewNode.tsx`)

```tsx
'use client';

import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { Attempt, Job, Verdict } from '../../lib/workerApi';
import { REJECT_REASONS, usedPreviews } from '../../lib/workerApi';
import { NodeCard, type Tone } from './NodeCard';

export type PreviewNodeData = {
  job: Job | null;
  /** Present when a new preview can be started right now. */
  onRunPreview: (() => void) | null;
  onVerdict: ((attemptId: string, verdict: Verdict, reasons: string[]) => void) | null;
  /** Present when the limit is reached and one more preview may be allowed. */
  onUnlock: (() => void) | null;
  attemptUrl: (attemptId: string) => string;
  previewCredits: number;
};

const latestOf = (job: Job | null): Attempt | undefined => job?.attempts[job.attempts.length - 1];

/** A new preview may start once the last one is judged (or failed) and the limit allows it. */
export function previewAllowed(job: Job): boolean {
  if (!job.previewRequired || job.status === 'running' || job.approvedAttemptId) return false;
  if (usedPreviews(job) >= job.previewLimit) return false;
  const latest = latestOf(job);
  return !latest || latest.status === 'failed' || latest.verdict === 'reject';
}

export function unlockAllowed(job: Job): boolean {
  if (!job.previewRequired || job.status === 'running' || job.approvedAttemptId) return false;
  const latest = latestOf(job);
  const judged = !latest || latest.status === 'failed' || latest.verdict === 'reject';
  return judged && usedPreviews(job) >= job.previewLimit;
}

function summarize(job: Job | null): { text: string; tone: Tone } {
  if (!job) return { text: '입력을 채우고 5초 미리보기를 만드세요', tone: 'idle' };
  if (job.status === 'running' && job.currentStage === 'preview') return { text: '5초 미리보기 만드는 중', tone: 'active' };
  if (job.approvedAttemptId) return { text: `승인됨 · 미리보기 ${usedPreviews(job)}회`, tone: 'done' };
  const latest = latestOf(job);
  if (latest?.status === 'failed') return { text: latest.error ?? '미리보기 실패', tone: 'failed' };
  return { text: `${usedPreviews(job)} / ${job.previewLimit}회 사용`, tone: job.attempts.length ? 'active' : 'idle' };
}

function pastLabel(a: Attempt): string {
  if (a.status === 'failed') return `${a.n}회 · 실패 (0크레딧)`;
  if (a.verdict === 'reject') return `${a.n}회 · 거절${a.reasons.length ? ` (${a.reasons.join(', ')})` : ''}`;
  if (a.verdict === 'approve') return `${a.n}회 · 승인`;
  return `${a.n}회 · 판정 전`;
}

export function PreviewNode({ data }: NodeProps & { data: PreviewNodeData }) {
  const { job } = data;
  const [reasons, setReasons] = useState<string[]>([]);
  const { text, tone } = summarize(job);
  const latest = latestOf(job);
  const judging = Boolean(
    job && latest && latest.status === 'done' && latest.verdict === null && !job.approvedAttemptId && job.status !== 'running',
  );
  const toggle = (r: string) => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const past = (job?.attempts ?? []).filter((a) => a !== latest || !judging);

  return (
    <NodeCard title="미리보기 (5초)" width={240} tone={tone} input output>
      <div className="text-[13px] leading-snug" style={{ color: tone === 'idle' ? 'var(--ink-muted)' : 'var(--ink)' }}>
        {text}
      </div>

      {latest?.status === 'done' && (
        <div className="mt-2 aspect-video w-full overflow-hidden rounded-md bg-[var(--well)]">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={latest.id} src={data.attemptUrl(latest.id)} controls muted playsInline preload="metadata" className="h-full w-full object-cover" />
        </div>
      )}

      {judging && latest && data.onVerdict && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className={`rounded-full border px-2 py-0.5 text-[11.5px] ${reasons.includes(r) ? 'border-[var(--danger)] text-[var(--ink)]' : 'border-[var(--card-border-strong)] text-[var(--ink-muted)]'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { data.onVerdict?.(latest.id, 'approve', []); setReasons([]); }}
              className="flex-1 rounded-md border border-[var(--media)] py-1.5 text-[12.5px] font-medium text-[var(--ink)] hover:bg-[var(--media)] hover:text-black"
            >
              이걸로 승인
            </button>
            <button
              type="button"
              onClick={() => { data.onVerdict?.(latest.id, 'reject', reasons); setReasons([]); }}
              className="flex-1 rounded-md border border-[var(--card-border-strong)] py-1.5 text-[12.5px] text-[var(--ink)] hover:border-[var(--danger)]"
            >
              거절
            </button>
          </div>
        </div>
      )}

      {data.onRunPreview && (
        <button
          type="button"
          onClick={data.onRunPreview}
          className="mt-2 w-full rounded-md border border-[var(--card-border-strong)] py-1.5 text-[12.5px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--media)] hover:text-[var(--media)]"
        >
          미리보기 만들기 · 약 {data.previewCredits}크레딧
        </button>
      )}

      {data.onUnlock && (
        <button
          type="button"
          onClick={data.onUnlock}
          className="mt-2 w-full rounded-md border border-[var(--danger)] py-1.5 text-[12.5px] text-[var(--ink)]"
        >
          한도 도달 · 1회 더 허용
        </button>
      )}

      {past.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-[var(--ink-muted)]">
          {past.map((a) => <li key={a.id}>{pastLabel(a)}</li>)}
        </ul>
      )}
    </NodeCard>
  );
}
```

- [ ] **Step 2: 생성 카드 — 승인 전 잠금과 제목** (`StageNode.tsx`)

`titles`의 `generate: '인물·제품 교체',` 를 `generate: '나머지 구간 생성',` 으로 바꾼다.

`canRunStage` 맨 앞 줄 다음에 추가:

```ts
  if (stage === 'generate' && job.previewRequired && !job.approvedAttemptId) return false;
```

`summarize`의 `const state = job.stages[stage];` 앞에 추가:

```ts
  if (stage === 'generate' && job.previewRequired && !job.approvedAttemptId) {
    return { text: '미리보기를 승인하면 실행됩니다', tone: 'idle' };
  }
```

생성 카드의 실행 버튼에 남은 비용을 보여준다. `StageNode.tsx` 위쪽(`canRunStage` 아래)에 추가:

```ts
/** "나머지 25초 만들기 · 약 175크레딧" — only the segments that still need generating. */
function generateButtonLabel(job: Job | null, failed: boolean): string {
  const pending = (job?.segments ?? []).filter((s) => s.status !== 'done');
  if (pending.length === 0) return failed ? '이 단계 다시 실행' : '이 단계만 실행';
  const seconds = Math.round(pending.reduce((sum, s) => sum + (s.endSeconds - s.startSeconds), 0));
  return `나머지 ${seconds}초 만들기 · 약 ${seconds * 7}크레딧`;
}
```

그리고 실행 버튼의 글자 `{state?.status === 'failed' ? '이 단계 다시 실행' : '이 단계만 실행'}` 을 다음으로 바꾼다:

```tsx
          {stage === 'generate'
            ? generateButtonLabel(job, state?.status === 'failed')
            : state?.status === 'failed' ? '이 단계 다시 실행' : '이 단계만 실행'}
```

- [ ] **Step 3: 캔버스 연결** (`Canvas.tsx`)

import 추가:

```ts
import { PreviewNode, previewAllowed, unlockAllowed, type PreviewNodeData } from './nodes/PreviewNode';
```

`workerApi` import 목록에 `runPreview, sendVerdict, unlockPreview, attemptOutputUrl, PREVIEW_CREDITS, type Verdict` 추가.

`nodeTypes`에 `preview: PreviewNode,` 추가, `AnyNodeData`에 `| PreviewNodeData` 추가.

`buildInitialNodes`: 미리보기 노드를 `generate` 자리에 넣고, `x >= 340`인 노드를 모두 오른쪽으로 290 옮긴다:

```ts
    { id: 'preview', type: 'preview', position: { x: 340, y: 260 }, data: { job: null, onRunPreview: null, onVerdict: null, onUnlock: null, attemptUrl: () => '', previewCredits: PREVIEW_CREDITS } },
    { id: 'generate', type: 'stage', position: { x: 630, y: 300 }, data: stage('generate') },
    { id: 'merge', type: 'stage', position: { x: 920, y: 300 }, data: stage('merge') },
    { id: 'restyle-prompt', type: 'textInput', position: { x: 920, y: 40 }, data: { /* 기존과 같음 */ } },
    { id: 'restyle', type: 'stage', position: { x: 1210, y: 300 }, data: stage('restyle') },
    { id: 'edit-prompt', type: 'textInput', position: { x: 1210, y: 560 }, data: { /* 기존과 같음 */ } },
    { id: 'edit', type: 'stage', position: { x: 1500, y: 300 }, data: stage('edit') },
    { id: 'script', type: 'textInput', position: { x: 1500, y: 40 }, data: { /* 기존과 같음 */ } },
    { id: 'voiceover', type: 'stage', position: { x: 1790, y: 300 }, data: stage('voiceover') },
    { id: 'result', type: 'result', position: { x: 2080, y: 270 }, data: { job: null, resultUrl: null } },
```

(`/* 기존과 같음 */` 자리에는 현재 코드의 data 객체를 그대로 둔다 — 좌표만 바뀐다.)

`edgeSpecs`의 입력 3개를 미리보기로 돌리고 미리보기 → 생성 연결을 추가:

```ts
  { id: 'video-preview', source: 'video', target: 'preview', color: MEDIA },
  { id: 'person-preview', source: 'person', target: 'preview', color: MEDIA },
  { id: 'product-preview', source: 'product', target: 'preview', color: MEDIA },
  { id: 'preview-generate', source: 'preview', target: 'generate', color: QUIET, stage: 'generate' },
```

(기존 `video-generate`, `person-generate`, `product-generate` 3줄은 삭제.)

`buildEdges`의 running 판정을 미리보기도 포함하게 바꾼다:

```ts
    className:
      job && ((e.stage && job.stages[e.stage]?.status === 'running') || (e.target === 'preview' && job.currentStage === 'preview'))
        ? 'is-running'
        : undefined,
```

`submit`의 `createJob({...})` 호출에 `preview: true,` 를 추가한다.

`submit` 정의 **바로 아래, `handleRunAll`보다 앞에** 핸들러 3개를 추가한다 (`handleRunAll`이 의존성 배열에서 `handleRunPreview`를 참조하므로, 뒤에 두면 렌더링 중 ReferenceError가 난다):

```ts
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
```

`dataById`의 `stageData`에서 `onRun` 조건의 `(!job && stage === 'generate' && !isSubmitting) ||` 부분을 삭제한다 (새 작업은 미리보기부터 시작).

`dataById` 반환 객체에 추가:

```ts
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
```

`useMemo` 의존성 배열에 `handleRunPreview, handleVerdict, handleUnlock` 추가.

하단 버튼: `handleRunAll`의 `if (!job) { await submit(true); return; }` 를 `if (!job) { await handleRunPreview(); return; }` 로 바꾸고(의존성에 `handleRunPreview` 추가), `runLabel`·`runDisabled`를 다음으로 바꾼다:

```ts
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
```

왼쪽 위 제목 옆에 비용 배지를 넣는다 — 제목 `<div …>얼굴·제품 교체 워크플로</div>` 를 다음으로 바꾼다:

```tsx
      <div className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-3 text-[13px] font-medium text-[var(--ink)]">
        <span>얼굴·제품 교체 워크플로</span>
        {job?.totals && (
          <span className="rounded-full border border-[var(--card-border-strong)] bg-[var(--card)] px-2.5 py-1 text-[12px] font-normal text-[var(--ink-muted)]">
            미리보기 {job.totals.previews}회 · {job.totals.credits}크레딧 · 약 {job.totals.krw.toLocaleString()}원
          </span>
        )}
      </div>
```

- [ ] **Step 4: 타입·테스트 확인**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc 에러 없음, vitest 전부 PASS

- [ ] **Step 5: 화면 확인 (크레딧 0)**

worker(4000)와 web(3000)을 띄우고 `http://localhost:3000` 을 연다.
확인할 것: 입력 → **미리보기 (5초)** → 나머지 구간 생성 → … 순서로 보임 / 예전 잡을 다시 열어도 에러 없이 보임 / 미리보기 카드에 "미리보기 만들기 · 약 35크레딧" / 나머지 구간 생성 카드에 "미리보기를 승인하면 실행됩니다" / 하단 버튼 "5초 미리보기 만들기" / 다크·라이트 전환 정상. **이 단계에서는 버튼을 누르지 않는다**(누르면 크레딧 사용).

- [ ] **Step 6: 커밋 (사용자가 요청하면)**

```bash
git add web/components/nodes/PreviewNode.tsx web/components/nodes/StageNode.tsx web/components/Canvas.tsx
git commit -m "feat(web): add the 5-second preview card and lock generation until approval"
```

---

### Task 10: 실제 크레딧 검증 (사용자 확인 후에만)

**Files:**
- Create: `docs/session-handoff-2026-09-29.md`
- Modify: `docs/higgsfield-cli-notes.md` (실측 결과 추가)

- [ ] **Step 1: 무료 비용 조회**

Run: `higgsfield generate cost ad_multiplier --mode video_edit --prompt "x" --video-references <5초 구간 파일> --image-references <인물 사진>` (크레딧 소모 없음)
Expected: 약 35. 35보다 크면 멈추고 사용자에게 보고.

- [ ] **Step 2: 잔액 확인**

Run: `higgsfield workspace list`
Expected: 잔액 ≥ 105 (검증 A) — 끝까지 한 편까지 하려면 ≥ 350. 모자라면 멈추고 사용자에게 보고.

- [ ] **Step 3: 검증 A — 5초 미리보기 3건 (약 105크레딧, 사용자 확인 후)**

UI에서 테스트 소재(Pexels 8143138 URL + AI 얼굴 + 아이라이너 제품)로 미리보기를 3번 만든다(매번 거절). 각 결과를 같은 설정의 10초 결과(`worker/data/test-*-20260922/23.mp4`)와 비교해 판정이 같은지 기록한다.
통과 기준: 1건 35크레딧 이하, 판정 3건 모두 일치.

- [ ] **Step 4: 끝까지 한 편 (약 175~245크레딧, 사용자 확인 후)**

미리보기 1건 승인 → "남은 단계 모두 실행". 완성 영상과 화면 비용 배지, `higgsfield account transactions`의 실제 차감을 비교한다.

- [ ] **Step 5: 기록**

`docs/session-handoff-2026-09-29.md`에: 브랜치·커밋, 테스트 수, 검증 A 결과(통과/실패, 판정 비교), 끝까지 한 편의 기록 크레딧 vs 실제 차감, 다음 할 일(1-B). 검증 A가 실패하면 `PREVIEW_SECONDS`를 10으로 바꾸는 후속 작업을 적는다.
