# 유튜브 인물 AI 캐릭터 교체 — 워커 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유튜브 URL + 캐릭터 사진을 입력받아, 원본 영상을 세그먼트로 나눠 Higgsfield Genjutsu(공식 CLI)로 각각 생성한 뒤 하나로 이어붙인 완성 영상을 반환하는 워커 서비스(Express API)를 만든다. Next.js 웹 UI는 포함하지 않음 — `curl`/Postman으로 API를 직접 호출해 전체 파이프라인을 끝까지 검증하는 것이 이 계획의 완료 기준.

**Architecture:** Node.js 워커 프로세스 하나. `src/pipeline/`에 순수 함수형 파이프라인 모듈(다운로드/분할/생성/병합/DB)을 두고, `src/server.js`가 이를 오케스트레이션하는 Express API로 감싼다. 외부 도구(yt-dlp, ffmpeg, higgsfield CLI)는 전부 `child_process.execFile`로 호출하며, 테스트에서는 이 실행 함수를 주입(dependency injection)해서 실제 바이너리 없이 로직만 검증한다.

**Tech Stack:** Node.js ≥18 (ESM, 내장 `node:test`), Express, multer, lowdb, 외부 CLI(yt-dlp, ffmpeg/ffprobe, @higgsfield/cli)

**Spec:** `docs/superpowers/specs/2026-09-14-video-creator-design.md`

## Global Constraints

- 세그먼트 길이는 4~30초 사이여야 함 (Higgsfield Genjutsu의 처리 한도) — 기본값 10초로 구현
- 캐릭터 이미지는 정확히 1개만 사용 (Higgsfield `kling3_0_motion_control` 워크플로우 제약 — 2026-09-15 실제 CLI 조사로 확인, 스펙 작성 당시 가정했던 "최대 49개"는 이 워크플로우와 무관한 다른 기능이었음)
- 생성 엔진 연동은 반드시 공식 Higgsfield CLI(`@higgsfield/cli`)로만 수행 — 브라우저 자동화(Playwright)는 사용하지 않음
- Job/세그먼트 상태 저장은 파일 기반 저장소(lowdb)만 사용 — Redis 등 큐 브로커 도입 금지 (1인용 로컬 도구 규모, YAGNI)
- 입력 영상은 본인 소유/권한 보유 영상으로 범위를 제한함 (코드로 강제하지는 않음 — 정책적 제약)
- 워커는 로컬 PC에서 상시 실행되는 프로세스로 동작 (서버리스 배포 대상 아님)

## 사전 준비물 (로컬 환경에 설치되어 있어야 함)

- Node.js 18 이상
- `yt-dlp` (`brew install yt-dlp` 등)
- `ffmpeg`/`ffprobe` (`brew install ffmpeg`)
- `@higgsfield/cli` 설치 및 `higgsfield auth login` 완료

---

## 파일 구조

```
worker/
  package.json
  .gitignore                    (data/, uploads/, node_modules/ 제외)
  src/
    pipeline/
      exec.js                   # child_process.execFile 프로미스 래퍼 (공용 기본 실행 함수)
      download.js                # downloadVideo() — yt-dlp 래퍼
      segment.js                 # getDuration(), splitIntoSegments() — ffprobe/ffmpeg 래퍼
      generate.js                # generateFromSegment() — higgsfield CLI 래퍼
      merge.js                   # mergeSegments() — ffmpeg xfade 크로스페이드 병합
      db.js                      # createDb(), createJob(), getJob(), listJobs(), updateJob()
      jobRunner.js                # runJob(), retrySegment() — 전체 오케스트레이션
    server.js                    # createApp() — Express 앱 팩토리
    index.js                     # 실제 서버 기동 엔트리포인트
  test/
    download.test.js
    segment.test.js
    generate.test.js
    merge.test.js
    db.test.js
    jobRunner.test.js
    server.test.js
docs/
  higgsfield-cli-notes.md        # Task 1 조사 결과 (실제 CLI 명령/플래그 기록)
```

---

### Task 1: Higgsfield CLI의 Genjutsu 지원 여부 확인 (스파이크)

이 계획 전체가 "공식 CLI로 Genjutsu를 호출할 수 있다"는 가정 위에 서 있음. 이걸 제일 먼저 확인하지 않으면 Task 5(generate.js)를 잘못된 가정으로 구현하게 됨.

**Files:**
- Create: `docs/higgsfield-cli-notes.md`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: `docs/higgsfield-cli-notes.md`에 기록되는 실제 CLI 명령 형식 — Task 5(generate.js)가 이 문서의 내용을 그대로 사용함

- [ ] **Step 1: CLI 설치 및 로그인**

```bash
npm i -g @higgsfield/cli
higgsfield auth login
```

브라우저가 열리면 기존 higgsfield.ai 계정(유료 멤버십)으로 로그인.

- [ ] **Step 2: 사용 가능한 명령어 탐색**

```bash
higgsfield --help
higgsfield generate --help
```

(정확한 서브커맨드명은 실제 출력을 보고 확인 — `generate`가 아닐 수도 있음. `video`, `create` 등 유사어도 확인)

- [ ] **Step 3: Genjutsu 관련 옵션 확인**

`--help` 출력에서 다음을 찾아 기록: 모델 선택 방법(`--model genjutsu` 형태인지), 모션 레퍼런스 영상 지정 플래그명, 캐릭터/제품 이미지 지정 플래그명(여러 개 지정 가능한지), 결과물 저장 경로 지정 플래그명, 명령이 **동기적으로 완료까지 블로킹되는지 vs 작업 ID를 반환하고 별도 폴링이 필요한지**.

- [ ] **Step 4: 짧은 테스트 영상으로 실제 호출**

4~10초짜리 아무 테스트 영상 1개 + 캐릭터 이미지 1장으로 실제 생성을 한 번 실행해보고, 성공하는 정확한 커맨드 한 줄을 확보.

- [ ] **Step 5: 조사 결과를 문서로 기록**

`docs/higgsfield-cli-notes.md`에 아래 형식으로 기록:

```markdown
# Higgsfield CLI 조사 결과

- 실제 성공한 명령어 전체: `higgsfield ??? ...`
- 모션 레퍼런스 플래그: `--???`
- 캐릭터 이미지 플래그 (반복 가능 여부): `--???`
- 출력 경로 플래그: `--???`
- 동기/비동기 여부: (동기 = 완료까지 블로킹 / 비동기 = job id 반환, 폴링 명령: `higgsfield ??? status <id>`)
- 무료 멤버십 한도 내 동작 여부: 예/아니오
```

- [ ] **판단 기준**: `higgsfield` CLI로 Genjutsu 호출이 안 되거나 무료 한도 밖이라면, **여기서 멈추고 사용자와 다시 상의** (Playwright 자동화로 되돌아가야 할 수 있음 — Task 2 이후는 진행하지 말 것). 성공했다면 Task 2로 진행.

---

### Task 2: 워커 프로젝트 스캐폴딩

**Files:**
- Create: `worker/package.json`
- Create: `worker/.gitignore`
- Create: `worker/src/pipeline/exec.js`

**Interfaces:**
- Produces: `execFile(command, args, options) => Promise<{ stdout, stderr }>` — 이후 모든 파이프라인 모듈이 기본값으로 사용하는 실행 함수

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "video-creator-worker",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "lowdb": "^7.0.1",
    "multer": "^1.4.5-lts.1"
  }
}
```

- [ ] **Step 2: 의존성 설치**

```bash
cd worker && npm install
```

- [ ] **Step 3: worker 전용 .gitignore 생성**

```
node_modules/
data/
uploads/
```

- [ ] **Step 4: 공용 exec 래퍼 작성**

`worker/src/pipeline/exec.js`:

```js
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

export const execFile = promisify(execFileCb);
```

- [ ] **Step 5: 정상 설치 확인**

```bash
node -e "import('./worker/src/pipeline/exec.js').then(() => console.log('ok'))"
```

Expected: `ok` 출력, 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add worker/package.json worker/package-lock.json worker/.gitignore worker/src/pipeline/exec.js
git commit -m "chore: scaffold worker project"
```

---

### Task 3: yt-dlp 다운로드 모듈

**Files:**
- Create: `worker/src/pipeline/download.js`
- Test: `worker/test/download.test.js`

**Interfaces:**
- Consumes: `execFile`from Task 2 (`./exec.js`)
- Produces: `downloadVideo(url, outputDir, { execFile }?) => Promise<{ filePath: string }>` — Task 8(jobRunner.js)이 이 함수를 사용함

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/download.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { downloadVideo } from '../src/pipeline/download.js';

test('downloadVideo calls yt-dlp with the correct output template and returns the file path', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const result = await downloadVideo('https://youtube.com/watch?v=abc', '/tmp/job1', {
    execFile: fakeExecFile,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'yt-dlp');
  assert.deepEqual(calls[0].args, [
    '-f', 'mp4',
    '-o', path.join('/tmp/job1', 'source.%(ext)s'),
    'https://youtube.com/watch?v=abc',
  ]);
  assert.equal(result.filePath, path.join('/tmp/job1', 'source.mp4'));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/download.test.js
```

Expected: FAIL — `Cannot find module '../src/pipeline/download.js'`

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/download.js`:

```js
import path from 'node:path';
import { execFile as defaultExecFile } from './exec.js';

export async function downloadVideo(url, outputDir, { execFile = defaultExecFile } = {}) {
  const outputTemplate = path.join(outputDir, 'source.%(ext)s');
  await execFile('yt-dlp', ['-f', 'mp4', '-o', outputTemplate, url]);
  const filePath = path.join(outputDir, 'source.mp4');
  return { filePath };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/download.test.js
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/download.js worker/test/download.test.js
git commit -m "feat: add yt-dlp download wrapper"
```

---

### Task 4: ffmpeg 세그먼트 분할 모듈

**Files:**
- Create: `worker/src/pipeline/segment.js`
- Test: `worker/test/segment.test.js`

**Interfaces:**
- Consumes: `execFile` from Task 2
- Produces:
  - `getDuration(filePath, { execFile }?) => Promise<number>` (초 단위) — Task 6(merge.js)이 사용
  - `splitIntoSegments(filePath, outputDir, segmentSeconds?, { execFile, duration }?) => Promise<Array<{ index: number, path: string, startSeconds: number, endSeconds: number }>>` — Task 8(jobRunner.js)이 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/segment.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getDuration, splitIntoSegments } from '../src/pipeline/segment.js';

test('getDuration parses ffprobe stdout as a float', async () => {
  const fakeExecFile = async () => ({ stdout: '35.500000\n', stderr: '' });
  const duration = await getDuration('/tmp/source.mp4', { execFile: fakeExecFile });
  assert.equal(duration, 35.5);
});

test('splitIntoSegments creates contiguous 10-second segments covering the full duration', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const segments = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile,
    duration: 25,
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], {
    index: 0,
    path: path.join('/tmp/job1', 'segment-000.mp4'),
    startSeconds: 0,
    endSeconds: 10,
  });
  assert.deepEqual(segments[1], {
    index: 1,
    path: path.join('/tmp/job1', 'segment-001.mp4'),
    startSeconds: 10,
    endSeconds: 20,
  });
  assert.deepEqual(segments[2], {
    index: 2,
    path: path.join('/tmp/job1', 'segment-002.mp4'),
    startSeconds: 20,
    endSeconds: 25,
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].args, [
    '-y',
    '-ss', '20',
    '-i', '/tmp/source.mp4',
    '-t', '5',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    path.join('/tmp/job1', 'segment-002.mp4'),
  ]);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/segment.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/segment.js`:

```js
import path from 'node:path';
import { execFile as defaultExecFile } from './exec.js';

export async function getDuration(filePath, { execFile = defaultExecFile } = {}) {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

export async function splitIntoSegments(
  filePath,
  outputDir,
  segmentSeconds = 10,
  { execFile = defaultExecFile, duration } = {},
) {
  const totalDuration = duration ?? (await getDuration(filePath, { execFile }));
  const segments = [];
  let index = 0;

  for (let start = 0; start < totalDuration; start += segmentSeconds) {
    const length = Math.min(segmentSeconds, totalDuration - start);
    const outPath = path.join(outputDir, `segment-${String(index).padStart(3, '0')}.mp4`);

    await execFile('ffmpeg', [
      '-y',
      '-ss', String(start),
      '-i', filePath,
      '-t', String(length),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      outPath,
    ]);

    segments.push({ index, path: outPath, startSeconds: start, endSeconds: start + length });
    index += 1;
  }

  return segments;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/segment.test.js
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/segment.js worker/test/segment.test.js
git commit -m "feat: add ffmpeg segment splitting"
```

---

### Task 5: Higgsfield CLI 생성 래퍼

**Files:**
- Create: `worker/src/pipeline/generate.js`
- Test: `worker/test/generate.test.js`

**Interfaces:**
- Consumes: `execFile` from Task 2
- Produces: `generateFromSegment(segmentPath, characterImagePath, outputPath, { execFile }?) => Promise<{ outputPath: string }>` — Task 8(jobRunner.js)이 사용 (주의: **단수** `characterImagePath` — 문자열 1개, 배열 아님)

**Task 1 조사 결과 반영됨** (`docs/higgsfield-cli-notes.md`, 2026-09-15 실제 CLI 실행으로 확인): 실제 워크플로우 이름은 `kling3_0_motion_control`이며, 이미지·영상 레퍼런스 각각 정확히 1개만 받음(웹 UI의 "최대 49개"는 이 CLI 워크플로우와 무관). `--duration`은 비용 조회 전용이라 실제 생성 명령엔 넣지 않음. 결과는 JSON의 `result_url` 필드에 원격 URL로 나오며, 로컬에 자동 저장되지 않으므로 `curl`로 직접 다운로드함. 실패 시 CLI가 0이 아닌 종료 코드를 반환해 `execFile`이 자동으로 reject하므로, 그 에러 메시지를 그대로 상위로 전파하면 됨(별도 파싱 불필요).

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/generate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFromSegment } from '../src/pipeline/generate.js';

test('generateFromSegment calls the Higgsfield CLI workflow, then downloads result_url', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([
          { id: 'job-123', status: 'succeeded', result_url: 'https://example.com/result.mp4' },
        ]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await generateFromSegment(
    '/tmp/job1/segment-000.mp4',
    '/tmp/job1/char1.png',
    '/tmp/job1/generated-0.mp4',
    { execFile: fakeExecFile },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'higgsfield');
  assert.deepEqual(calls[0].args, [
    'generate', 'workflow', 'kling3_0_motion_control',
    '--video-references', '/tmp/job1/segment-000.mp4',
    '--image-references', '/tmp/job1/char1.png',
    '--mode', 'std',
    '--wait', '--json',
  ]);

  assert.equal(calls[1].command, 'curl');
  assert.deepEqual(calls[1].args, [
    '-sS', '-o', '/tmp/job1/generated-0.mp4', 'https://example.com/result.mp4',
  ]);

  assert.equal(result.outputPath, '/tmp/job1/generated-0.mp4');
});

test('generateFromSegment throws a clear error when the job has no result_url', async () => {
  const fakeExecFile = async (command) => {
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([{ id: 'job-456', status: 'failed', result_url: null }]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  await assert.rejects(
    generateFromSegment('/tmp/a.mp4', '/tmp/char.png', '/tmp/out.mp4', { execFile: fakeExecFile }),
    /job-456/,
  );
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/generate.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/generate.js`:

```js
import { execFile as defaultExecFile } from './exec.js';

export async function generateFromSegment(
  segmentPath,
  characterImagePath,
  outputPath,
  { execFile = defaultExecFile } = {},
) {
  const { stdout } = await execFile('higgsfield', [
    'generate', 'workflow', 'kling3_0_motion_control',
    '--video-references', segmentPath,
    '--image-references', characterImagePath,
    '--mode', 'std',
    '--wait', '--json',
  ]);

  const [job] = JSON.parse(stdout);
  if (!job.result_url) {
    throw new Error(`Higgsfield job ${job.id} finished without a result_url (status: ${job.status})`);
  }

  await execFile('curl', ['-sS', '-o', outputPath, job.result_url]);
  return { outputPath };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/generate.test.js
```

Expected: PASS (2/2)

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/generate.js worker/test/generate.test.js
git commit -m "feat: add higgsfield CLI generation wrapper"
```

---

### Task 6: ffmpeg 크로스페이드 병합 모듈

**Files:**
- Create: `worker/src/pipeline/merge.js`
- Test: `worker/test/merge.test.js`

**Interfaces:**
- Consumes: `execFile` from Task 2, `getDuration` from Task 4 (`./segment.js`)
- Produces: `mergeSegments(segmentPaths, outputPath, { execFile, crossfadeSeconds, getDuration }?) => Promise<{ outputPath: string }>` — Task 8(jobRunner.js)이 사용

세그먼트가 1개뿐이면 크로스페이드 없이 단순 복사, 2개 이상이면 `xfade`/`acrossfade` 필터를 체이닝해서 병합함 (스펙 §4-4의 연속성 완화책).

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/merge.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSegments } from '../src/pipeline/merge.js';

test('mergeSegments copies directly when there is only one segment', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const result = await mergeSegments(['/tmp/a.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    getDuration: async () => 10,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['-y', '-i', '/tmp/a.mp4', '-c', 'copy', '/tmp/final.mp4']);
  assert.equal(result.outputPath, '/tmp/final.mp4');
});

test('mergeSegments builds a chained xfade/acrossfade filter for 3 segments', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };
  const durations = { '/tmp/a.mp4': 10, '/tmp/b.mp4': 10, '/tmp/c.mp4': 5 };
  const fakeGetDuration = async (filePath) => durations[filePath];

  await mergeSegments(['/tmp/a.mp4', '/tmp/b.mp4', '/tmp/c.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    crossfadeSeconds: 0.5,
    getDuration: fakeGetDuration,
  });

  assert.equal(calls.length, 1);
  const [command, args] = [calls[0].command, calls[0].args];
  assert.equal(command, 'ffmpeg');
  assert.deepEqual(args.slice(0, 7), [
    '-y',
    '-i', '/tmp/a.mp4',
    '-i', '/tmp/b.mp4',
    '-i', '/tmp/c.mp4',
  ]);
  const filterComplexIndex = args.indexOf('-filter_complex');
  assert.ok(filterComplexIndex >= 0);
  const filterComplex = args[filterComplexIndex + 1];
  assert.equal(
    filterComplex,
    '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v1];' +
      '[0:a][1:a]acrossfade=d=0.5[a1];' +
      '[v1][2:v]xfade=transition=fade:duration=0.5:offset=19[v2];' +
      '[a1][2:a]acrossfade=d=0.5[a2]',
  );
  assert.deepEqual(args.slice(-5), ['-map', '[v2]', '-map', '[a2]', '/tmp/final.mp4']);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/merge.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/merge.js`:

```js
import { execFile as defaultExecFile } from './exec.js';
import { getDuration as defaultGetDuration } from './segment.js';

export async function mergeSegments(
  segmentPaths,
  outputPath,
  { execFile = defaultExecFile, crossfadeSeconds = 0.5, getDuration = defaultGetDuration } = {},
) {
  if (segmentPaths.length === 0) {
    throw new Error('mergeSegments requires at least one segment');
  }

  if (segmentPaths.length === 1) {
    await execFile('ffmpeg', ['-y', '-i', segmentPaths[0], '-c', 'copy', outputPath]);
    return { outputPath };
  }

  const durations = [];
  for (const segmentPath of segmentPaths) {
    durations.push(await getDuration(segmentPath, { execFile }));
  }

  const inputArgs = segmentPaths.flatMap((p) => ['-i', p]);

  let videoLabel = '[0:v]';
  let audioLabel = '[0:a]';
  let cumulativeOffset = durations[0];
  const filters = [];

  for (let i = 1; i < segmentPaths.length; i += 1) {
    const offset = cumulativeOffset - crossfadeSeconds;
    const nextVideoLabel = `[v${i}]`;
    const nextAudioLabel = `[a${i}]`;

    filters.push(
      `${videoLabel}[${i}:v]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${offset}${nextVideoLabel}`,
    );
    filters.push(`${audioLabel}[${i}:a]acrossfade=d=${crossfadeSeconds}${nextAudioLabel}`);

    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
    cumulativeOffset += durations[i] - crossfadeSeconds;
  }

  const filterComplex = filters.join(';');

  await execFile('ffmpeg', [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', videoLabel,
    '-map', audioLabel,
    outputPath,
  ]);

  return { outputPath };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/merge.test.js
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/merge.js worker/test/merge.test.js
git commit -m "feat: add ffmpeg crossfade merge"
```

---

### Task 7: Job 상태 저장소 (lowdb)

**Files:**
- Create: `worker/src/pipeline/db.js`
- Test: `worker/test/db.test.js`

**Interfaces:**
- Produces:
  - `createDb(dbPath) => Low` (lowdb 인스턴스)
  - `createJob(db, { id, youtubeUrl, characterImagePaths }) => Promise<Job>`
  - `getJob(db, id) => Promise<Job|null>`
  - `listJobs(db) => Promise<Job[]>`
  - `updateJob(db, id, patch) => Promise<Job>`
  - `Job` shape: `{ id, youtubeUrl, characterImagePaths, status, segments: [], resultPath: null, createdAt }` (Task 8이 실패 시 `error: string` 필드를 `updateJob`으로 추가함 — `updateJob`의 `patch`는 임의 필드를 허용하므로 스키마 변경 불필요)
  - Task 8(jobRunner.js), Task 9(server.js)가 이 함수들을 사용함

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob, listJobs, updateJob } from '../src/pipeline/db.js';

test('createJob, getJob, listJobs, updateJob round-trip through a real temp file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));

  const created = await createJob(db, {
    id: 'job-1',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
  });

  assert.equal(created.status, 'pending');
  assert.deepEqual(created.segments, []);
  assert.equal(created.resultPath, null);

  const fetched = await getJob(db, 'job-1');
  assert.equal(fetched.id, 'job-1');

  const all = await listJobs(db);
  assert.equal(all.length, 1);

  const updated = await updateJob(db, 'job-1', { status: 'downloading' });
  assert.equal(updated.status, 'downloading');

  const refetched = await getJob(db, 'job-1');
  assert.equal(refetched.status, 'downloading');

  assert.equal(await getJob(db, 'missing'), null);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/db.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/db.js`:

```js
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

export function createDb(dbPath) {
  const adapter = new JSONFile(dbPath);
  return new Low(adapter, { jobs: [] });
}

export async function createJob(db, { id, youtubeUrl, characterImagePaths }) {
  await db.read();
  db.data ||= { jobs: [] };

  const job = {
    id,
    youtubeUrl,
    characterImagePaths,
    status: 'pending',
    segments: [],
    resultPath: null,
    createdAt: new Date().toISOString(),
  };

  db.data.jobs.push(job);
  await db.write();
  return job;
}

export async function getJob(db, id) {
  await db.read();
  return db.data.jobs.find((job) => job.id === id) ?? null;
}

export async function listJobs(db) {
  await db.read();
  return db.data.jobs;
}

export async function updateJob(db, id, patch) {
  await db.read();
  const job = db.data.jobs.find((j) => j.id === id);
  if (!job) {
    throw new Error(`Job not found: ${id}`);
  }
  Object.assign(job, patch);
  await db.write();
  return job;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/db.test.js
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/db.js worker/test/db.test.js
git commit -m "feat: add lowdb-backed job store"
```

---

### Task 8: Job 오케스트레이터

**Files:**
- Create: `worker/src/pipeline/jobRunner.js`
- Test: `worker/test/jobRunner.test.js`

**Interfaces:**
- Consumes: `downloadVideo`(Task 3), `splitIntoSegments`(Task 4), `generateFromSegment`(Task 5), `mergeSegments`(Task 6), `getJob`/`updateJob`(Task 7)
- Produces:
  - `runJob(db, jobId, workDir, deps?) => Promise<{ resultPath: string }>`
  - `retrySegment(db, jobId, segmentIndex, workDir, deps?) => Promise<{ outputPath: string }>`
  - Task 9(server.js)가 이 두 함수를 사용함

`deps`는 `{ downloadVideo, splitIntoSegments, generateFromSegment, mergeSegments }` 형태로, 테스트에서 실제 외부 도구 호출 없이 로직만 검증하기 위해 주입 가능해야 함.

**범위 노트**: `retrySegment`는 해당 세그먼트만 재생성함 — 성공해도 최종 병합 영상을 자동으로 다시 만들지는 않음 (전체 재병합은 이 계획의 범위 밖, 필요하면 `mergeSegments`를 수동으로 다시 호출). 1인용 MVP에서는 실패가 드물 것으로 가정하고 YAGNI 원칙에 따라 자동 재병합은 생략함.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/jobRunner.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDb, createJob, getJob } from '../src/pipeline/db.js';
import { runJob, retrySegment } from '../src/pipeline/jobRunner.js';

async function setup() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobrunner-test-'));
  const db = createDb(path.join(tmpDir, 'db.json'));
  await createJob(db, {
    id: 'job-1',
    youtubeUrl: 'https://youtube.com/watch?v=abc',
    characterImagePaths: ['/tmp/char.png'],
  });
  return { db, tmpDir };
}

test('runJob walks the full pipeline and marks the job done', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
      { index: 1, path: '/tmp/segment-001.mp4', startSeconds: 10, endSeconds: 15 },
    ],
    generateFromSegment: async (segmentPath, _chars, outputPath) => ({ outputPath }),
    mergeSegments: async (_paths, outputPath) => ({ outputPath }),
  };

  const result = await runJob(db, 'job-1', tmpDir, deps);

  assert.equal(result.resultPath, path.join(tmpDir, 'final.mp4'));

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'done');
  assert.equal(job.resultPath, path.join(tmpDir, 'final.mp4'));
  assert.equal(job.segments.length, 2);
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[1].status, 'done');
});

test('runJob marks the failing segment and the job itself as failed, and stops before merging', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
    ],
    generateFromSegment: async () => {
      throw new Error('higgsfield call failed');
    },
    mergeSegments: async () => {
      throw new Error('should not be called');
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /higgsfield call failed/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'failed');
  assert.equal(job.segments[0].error, 'higgsfield call failed');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'higgsfield call failed');
});

test('runJob marks the job as failed (with no segments recorded) when the download step itself fails', async () => {
  const { db, tmpDir } = await setup();

  const deps = {
    downloadVideo: async () => {
      throw new Error('video unavailable');
    },
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, deps), /video unavailable/);

  const job = await getJob(db, 'job-1');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'video unavailable');
  assert.deepEqual(job.segments, []);
});

test('retrySegment re-runs a single segment and updates only that segment', async () => {
  const { db, tmpDir } = await setup();

  const failingDeps = {
    downloadVideo: async () => ({ filePath: '/tmp/source.mp4' }),
    splitIntoSegments: async () => [
      { index: 0, path: '/tmp/segment-000.mp4', startSeconds: 0, endSeconds: 10 },
    ],
    generateFromSegment: async () => {
      throw new Error('boom');
    },
    mergeSegments: async () => ({ outputPath: path.join(tmpDir, 'final.mp4') }),
  };

  await assert.rejects(runJob(db, 'job-1', tmpDir, failingDeps));

  const retryResult = await retrySegment(db, 'job-1', 0, tmpDir, {
    generateFromSegment: async (_segmentPath, _chars, outputPath) => ({ outputPath }),
  });

  assert.equal(retryResult.outputPath, path.join(tmpDir, 'generated-0.mp4'));

  const job = await getJob(db, 'job-1');
  assert.equal(job.segments[0].status, 'done');
  assert.equal(job.segments[0].resultPath, path.join(tmpDir, 'generated-0.mp4'));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/jobRunner.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/pipeline/jobRunner.js`:

```js
import path from 'node:path';
import { downloadVideo as defaultDownloadVideo } from './download.js';
import { splitIntoSegments as defaultSplitIntoSegments } from './segment.js';
import { generateFromSegment as defaultGenerateFromSegment } from './generate.js';
import { mergeSegments as defaultMergeSegments } from './merge.js';
import { getJob, updateJob } from './db.js';

async function setSegmentStatus(db, jobId, index, status, resultPath, error) {
  const job = await getJob(db, jobId);
  const segment = job.segments.find((s) => s.index === index);
  segment.status = status;
  segment.resultPath = resultPath;
  if (error) {
    segment.error = error;
  }
  await updateJob(db, jobId, { segments: job.segments });
}

export async function runJob(db, jobId, workDir, deps = {}) {
  const downloadVideo = deps.downloadVideo ?? defaultDownloadVideo;
  const splitIntoSegments = deps.splitIntoSegments ?? defaultSplitIntoSegments;
  const generateFromSegment = deps.generateFromSegment ?? defaultGenerateFromSegment;
  const mergeSegments = deps.mergeSegments ?? defaultMergeSegments;

  const job = await getJob(db, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  try {
    await updateJob(db, jobId, { status: 'downloading' });
    const { filePath: sourcePath } = await downloadVideo(job.youtubeUrl, workDir);

    await updateJob(db, jobId, { status: 'segmenting' });
    const segments = await splitIntoSegments(sourcePath, workDir, 10);
    await updateJob(db, jobId, {
      segments: segments.map((s) => ({ ...s, status: 'pending', resultPath: null })),
    });

    await updateJob(db, jobId, { status: 'generating' });
    const resultPaths = [];
    for (const segment of segments) {
      const outputPath = path.join(workDir, `generated-${segment.index}.mp4`);
      try {
        await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath);
        resultPaths.push(outputPath);
        await setSegmentStatus(db, jobId, segment.index, 'done', outputPath);
      } catch (error) {
        await setSegmentStatus(db, jobId, segment.index, 'failed', null, error.message);
        throw error;
      }
    }

    await updateJob(db, jobId, { status: 'merging' });
    const finalPath = path.join(workDir, 'final.mp4');
    await mergeSegments(resultPaths, finalPath);

    await updateJob(db, jobId, { status: 'done', resultPath: finalPath });
    return { resultPath: finalPath };
  } catch (error) {
    // Persist failure regardless of which stage threw (download/segment/generate/merge),
    // so GET /jobs/:id never shows a job stuck forever in an in-progress status.
    await updateJob(db, jobId, { status: 'failed', error: error.message });
    throw error;
  }
}

export async function retrySegment(db, jobId, segmentIndex, workDir, deps = {}) {
  const generateFromSegment = deps.generateFromSegment ?? defaultGenerateFromSegment;

  const job = await getJob(db, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const segment = job.segments.find((s) => s.index === segmentIndex);
  if (!segment) {
    throw new Error(`Segment not found: ${segmentIndex}`);
  }

  const outputPath = path.join(workDir, `generated-${segmentIndex}.mp4`);
  try {
    await generateFromSegment(segment.path, job.characterImagePaths[0], outputPath);
    await setSegmentStatus(db, jobId, segmentIndex, 'done', outputPath);
  } catch (error) {
    await setSegmentStatus(db, jobId, segmentIndex, 'failed', null, error.message);
    throw error;
  }

  return { outputPath };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/jobRunner.test.js
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add worker/src/pipeline/jobRunner.js worker/test/jobRunner.test.js
git commit -m "feat: add job orchestrator with retry support"
```

---

### Task 9: Express API 서버

**Files:**
- Create: `worker/src/server.js`
- Create: `worker/src/index.js`
- Test: `worker/test/server.test.js`

**Interfaces:**
- Consumes: `createDb`/`createJob`/`getJob`/`listJobs`(Task 7), `runJob`/`retrySegment`(Task 8)
- Produces: `createApp({ dataDir, runJob?, retrySegment? }) => express.Express` — 실제 서버 기동(`index.js`)과 테스트 양쪽에서 사용

`createApp`은 `runJob`/`retrySegment`를 주입받을 수 있어야 함 — 테스트에서 실제 yt-dlp/ffmpeg/higgsfield 호출 없이 라우팅과 상태 저장만 검증하기 위함.

**API:**
- `POST /jobs` (multipart: `youtubeUrl` 필드 + `characterImages` 파일 정확히 1개) → 201, job 객체 반환. 백그라운드로 `runJob` 실행 시작 (응답은 기다리지 않음)
- `GET /jobs` → 200, job 배열
- `GET /jobs/:id` → 200 job 객체, 없으면 404
- `POST /jobs/:id/segments/:index/retry` → `retrySegment` 실행, 200 `{ ok: true }` 또는 실패 시 500
- `GET /jobs/:id/result` → 완성된 영상 파일을 스트림으로 반환, 없으면 404

- [ ] **Step 1: 실패하는 테스트 작성**

`worker/test/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

async function startTestServer(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-test-'));
  const app = createApp({
    dataDir,
    runJob: overrides.runJob ?? (async () => ({ resultPath: '/tmp/final.mp4' })),
    retrySegment: overrides.retrySegment ?? (async () => ({ outputPath: '/tmp/generated-0.mp4' })),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://localhost:${port}` };
}

test('POST /jobs creates a job and GET /jobs lists it', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    form.append('youtubeUrl', 'https://youtube.com/watch?v=abc');
    form.append('characterImages', new Blob([new Uint8Array([1, 2, 3])]), 'char.png');

    const createRes = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.youtubeUrl, 'https://youtube.com/watch?v=abc');
    assert.equal(created.status, 'pending');

    const listRes = await fetch(`${baseUrl}/jobs`);
    const jobs = await listRes.json();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, created.id);
  } finally {
    server.close();
  }
});

test('POST /jobs without youtubeUrl returns 400', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const form = new FormData();
    const res = await fetch(`${baseUrl}/jobs`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('GET /jobs/:id returns 404 for an unknown job', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/jobs/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd worker && node --test test/server.test.js
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현 작성**

`worker/src/server.js`:

```js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDb, createJob, getJob, listJobs } from './pipeline/db.js';
import { runJob as defaultRunJob, retrySegment as defaultRetrySegment } from './pipeline/jobRunner.js';

export function createApp({ dataDir, runJob = defaultRunJob, retrySegment = defaultRetrySegment }) {
  const app = express();
  app.use(cors());

  const db = createDb(path.join(dataDir, 'db.json'));
  const upload = multer({ dest: path.join(dataDir, 'uploads') });

  app.post('/jobs', upload.array('characterImages', 1), async (req, res) => {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) {
      res.status(400).json({ error: 'youtubeUrl is required' });
      return;
    }

    const id = randomUUID();
    const characterImagePaths = (req.files ?? []).map((file) => file.path);
    const job = await createJob(db, { id, youtubeUrl, characterImagePaths });

    const workDir = path.join(dataDir, 'jobs', id);
    await fs.mkdir(workDir, { recursive: true });

    runJob(db, id, workDir).catch((error) => {
      console.error(`Job ${id} failed:`, error.message);
    });

    res.status(201).json(job);
  });

  app.get('/jobs', async (_req, res) => {
    res.json(await listJobs(db));
  });

  app.get('/jobs/:id', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(job);
  });

  app.post('/jobs/:id/segments/:index/retry', async (req, res) => {
    const workDir = path.join(dataDir, 'jobs', req.params.id);
    try {
      const result = await retrySegment(db, req.params.id, Number(req.params.index), workDir);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/jobs/:id/result', async (req, res) => {
    const job = await getJob(db, req.params.id);
    if (!job || !job.resultPath) {
      res.status(404).json({ error: 'result not ready' });
      return;
    }
    res.sendFile(job.resultPath);
  });

  return app;
}
```

`worker/src/index.js`:

```js
import path from 'node:path';
import { createApp } from './server.js';

const dataDir = path.join(process.cwd(), 'data');
const port = process.env.PORT ?? 4000;

const app = createApp({ dataDir });
app.listen(port, () => {
  console.log(`worker listening on http://localhost:${port}`);
});
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
cd worker && node --test test/server.test.js
```

Expected: PASS

- [ ] **Step 5: 전체 테스트 스위트 통과 확인**

```bash
cd worker && npm test
```

Expected: 모든 테스트 PASS (Task 3~9에서 작성한 것 전부)

- [ ] **Step 6: 커밋**

```bash
git add worker/src/server.js worker/src/index.js worker/test/server.test.js
git commit -m "feat: add Express API for job management"
```

---

### Task 10: End-to-End 수동 검증

여기부터는 자동 테스트가 아니라 **실제 도구(yt-dlp, ffmpeg, higgsfield CLI)를 다 설치한 상태에서 진짜로 실행**해보는 단계.

**Files:** 없음 (검증만 수행)

- [ ] **Step 1: 워커 서버 기동**

```bash
cd worker && npm start
```

Expected: `worker listening on http://localhost:4000` 출력

- [ ] **Step 2: 짧은(1분 이내) 본인 소유 유튜브 영상 + 캐릭터 사진 1장으로 job 생성**

```bash
curl -X POST http://localhost:4000/jobs \
  -F "youtubeUrl=<본인 영상 URL>" \
  -F "characterImages=@/path/to/character.png"
```

Expected: `201`, job id를 포함한 JSON 응답

- [ ] **Step 3: 상태 폴링**

```bash
curl http://localhost:4000/jobs/<job-id>
```

`status`가 `pending → downloading → segmenting → generating → merging → done` 순서로 바뀌는지 몇 초 간격으로 확인. `segments` 배열의 각 항목 status도 함께 확인.

- [ ] **Step 4: 완성 영상 다운로드 및 육안 검토**

```bash
curl -o result.mp4 http://localhost:4000/jobs/<job-id>/result
```

`result.mp4`를 재생해서: (a) AI 캐릭터로 교체가 잘 됐는지, (b) 세그먼트 경계에서 동작이 부자연스럽게 끊기지 않는지(스펙 §9의 알려진 리스크) 확인.

- [ ] **Step 5: 실패 케이스 확인 — 세그먼트 재시도**

한 세그먼트가 실패했다고 가정하고 재시도 엔드포인트 호출:

```bash
curl -X POST http://localhost:4000/jobs/<job-id>/segments/0/retry
```

Expected: `{ "ok": true, ... }`, 해당 세그먼트만 다시 생성됨 (다른 세그먼트는 영향 없음)

- [ ] **판단 기준**: 이 단계가 끝까지 성공하면 워커는 완료. 세그먼트 연속성이 눈에 띄게 부자연스럽다면, 스펙 §9에 기록된 대로 "완벽한 보장 방법 없음"을 사용자에게 다시 알리고 크로스페이드 길이 조정(`crossfadeSeconds` 파라미터) 또는 문제 세그먼트 수동 재생성으로 대응. 이후 Next.js 웹 UI는 별도 계획으로 진행.
