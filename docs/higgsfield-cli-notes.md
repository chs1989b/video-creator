# Higgsfield CLI 조사 결과

- 조사일: 2026-09-15
- CLI 버전: `@higgsfield/cli` (npm, 최신)

## 인증 및 워크스페이스

```bash
npm i -g @higgsfield/cli
higgsfield auth login          # 브라우저 OAuth 로그인
higgsfield workspace list      # 워크스페이스 ID 확인 (예: free plan, 10 크레딧)
higgsfield workspace set <워크스페이스 ID>   # 필수 — 안 하면 대부분의 명령이 "No workspace selected" 에러
```

## "Genjutsu"라는 이름의 워크플로우는 없음

`higgsfield workflow list` 결과에 "genjutsu"라는 이름은 존재하지 않았음. 대신 웹 UI에서 봤던 "모션을 가져와서 다른 캐릭터로 재구성" 기능은 CLI 워크플로우 **`kling3_0_motion_control`** ("Kling 3.0 Motion Control")로 확인됨.

## 실제 성공한(예정) 명령어 형태

```bash
higgsfield generate workflow kling3_0_motion_control \
  --video-references ./segment.mp4 \
  --image-references ./character.png \
  --wait
```

(`--video`/`--image`는 각각 `--video-references`/`--image-references`의 축약 별칭)

## 파라미터 (`higgsfield workflow get kling3_0_motion_control` 결과)

| 파라미터 | 타입 | 기본값 | 필수 | 비고 |
|---|---|---|---|---|
| `video_references` | array | — | 예 (**정확히 1개**) | `--video-references` 또는 `--video` 반복 사용 |
| `image_references` | array | — | 예 (**정확히 1개**) | `--image-references` 또는 `--image` 반복 사용 |
| `mode` | std, pro | std | 아니오 | |
| `background_source` | input_image, input_video | — | 아니오 | 용도 불명확, 우리 파이프라인에서는 미사용 예정 |

**⚠️ 스펙 문서(§5)와의 차이**: 스펙은 Higgsfield 웹 UI의 "캐릭터 이미지 최대 49개" 설명을 근거로 작성됐으나, 실제 이 CLI 워크플로우는 **이미지 정확히 1개, 영상 정확히 1개**만 받음. 웹 UI의 "49개" 제한은 다른 (웹 전용) 기능이거나 다른 워크플로우일 가능성이 높음. **이 계획은 CLI로 실행하므로, 이후 모든 태스크는 "캐릭터 이미지 1개"를 기준으로 조정함.**

## 동기/비동기 여부

`--wait` 플래그를 붙이면 완료까지 블로킹되는 것으로 보임 (다른 워크플로우 예시 `higgsfield generate workflow reframe --video ./source.mp4 --aspect-ratio 9:16 --resolution 720p --wait`에서도 동일 패턴 확인). `--wait` 없이 실행하면 비동기로 job을 생성하고, `higgsfield generate get <job_id>` 또는 `higgsfield generate wait <job_id>`로 폴링 가능한 것으로 추정.

## 비용 (크레딧 소모량) — `generate cost workflow`로 사전 확인 가능, 크레딧 소모 없음

`--duration`은 비용 조회 전용 파라미터임 (실제 생성 명령에는 존재하지 않음 — 아래 참고). 미디어 파일 없이 `--duration`/`--mode`만으로 조회 가능:

```bash
higgsfield generate cost workflow kling3_0_motion_control --duration 5 --mode std
```

실측치: 4초 = 8크레딧, 5초 = 10크레딧, 10초 = 17크레딧 (거의 선형, 초당 약 1.7~2크레딧). 무료 크레딧이 10개뿐이라 4초짜리 1회 테스트만 해도 대부분 소진됨.

## 실제 성공하는 생성 명령 (2026-09-15 실제 실행으로 확인)

```bash
higgsfield generate workflow kling3_0_motion_control \
  --video-references ./segment.mp4 \
  --image-references ./character.png \
  --mode std --wait --json
```

**`--duration` 플래그는 이 명령에는 없음** — 넣으면 `Error: Unknown params: duration`. 영상 길이에서 자동 추론됨 (실제 응답의 `params.duration`에 반영됨).

로컬 파일 경로를 그대로 넘기면 자동으로 업로드됨 (`medias[].data.url`에 업로드된 CDN URL이 채워짐).

## `--wait --json` 응답 구조 (2026-09-15 실제 실행 결과로 확인)

JSON 배열(요소 1개)로 출력됨:

```json
[
  {
    "id": "80c5639b-...",
    "job_type": "kling3_0_motion_control",
    "status": "failed",           // 성공 시 "completed" (2026-09-15 실제 성공 사례로 확인 — "succeeded" 아니었음)
    "result_url": null,           // 성공 시 여기에 결과 영상 URL이 들어감
    "min_result_url": null,
    "params": { "duration": 4, "mode": "std", "width": 320, "height": 240, "character_orientation": "video", ... },
    "created_at": "..."
  }
]
```

**결과 영상은 `result_url` 필드의 URL**이며, 로컬 파일로 자동 저장되지 않음 — 별도로 다운로드해야 함 (`curl -fsSL -o <경로> <result_url>` 등).

**실패 처리**: 최초 테스트는 합성 테스트 패턴(실제 사람 동작 아님)이라 `"status": "failed"`로 끝남 — CLI는 이때 **exit code 3**을 반환하고 stderr에 `Error: job <id> ended with status "failed"`를 출력함. 실패는 credit을 소모하지 않는 것으로 확인됨(테스트 전후 잔여 크레딧 10개로 동일). `execFile`은 0이 아닌 종료 코드에서 reject하므로, 별도 JSON 파싱 없이 그 reject된 에러 메시지를 그대로 세그먼트 에러로 기록하면 충분함.

## ✅ 실제 성공 사례 확인 (2026-09-15, Task 10 E2E 검증)

본인 소유 유튜브 Shorts 영상(15.4초, 앞 4초만 트리밍)과 실제 얼굴 사진으로 재검증 성공:

- `"status": "completed"`, `result_url`에 실제 결과 영상 CDN URL 채워짐
- 4초 생성에 정확히 **8크레딧** 소모 (사전 비용 조회와 일치)
- 다운로드한 결과 영상 육안 확인: 캐릭터 사진 속 인물이 원본 영상 속 사람의 동작(포즈, 표정)을 자연스럽게 재연함 — 모션 전이가 실제로 잘 작동함을 확인
- `generateFromSegment`의 성공 판정 로직(`result_url` 존재 여부만 확인, `status` 값 자체는 안 봄)이 실제 값이 "succeeded"가 아니라 "completed"였음에도 문제없이 정상 동작함을 확인 — 코드 수정 불필요

## 무료 멤버십 한도 내 동작 여부

가입만 하고 결제 전 상태, 무료 크레딧 10개 중 8개 사용, **잔여 2개**. 워크스페이스/워크플로우 조회는 크레딧 미소모. 실제 생성 요청은 성공해야만 크레딧이 차감되는 것으로 확인됨 (실패 시 무료). 여러 세그먼트를 이어붙이는 연속성 테스트(세그먼트당 8~17크레딧)는 크레딧이 부족해 아직 미검증 — 유료 전환 또는 크레딧 추가 확보 후 진행 필요.

## 🐛 실제로 발견한 버그: 캐릭터 이미지 확장자 누락 (2026-09-16)

**유료 플랜 전환 후 실제 다세그먼트(15.4초 → 10초+5.4초) E2E 테스트 중 발견**: 첫 세그먼트가 1시간 넘게 멈춰서 진행이 안 됨 (네트워크 활동 전혀 없음, Higgsfield 자체 job 목록에도 안 나타남). 워커를 거치지 않고 CLI를 직접 실행해보니 즉시 다음 에러가 남:

```
Error: Cannot detect media type from extension "".
```

**원인**: `worker/src/server.js`의 multer 설정이 `multer({ dest: ... })` 형태였는데, 이 방식은 업로드된 파일을 **확장자 없이** 랜덤 해시 이름으로 저장함 (multer의 기본 동작). Higgsfield CLI는 파일 확장자로 미디어 타입을 판단하기 때문에, 확장자 없는 이미지를 넘기면 내부적으로 이상한 상태에 빠지는 것으로 보임 (매번 즉시 에러가 나는 게 아니라 어떤 경우엔 그냥 응답 없이 멈춤 — CLI 쪽의 방어적이지 못한 처리로 추정).

**수정**: `multer.diskStorage`로 바꿔서 원본 파일의 확장자를 유지하도록 함 (`worker/src/server.js`). 이 과정에서 `diskStorage`는 `dest:` 축약형과 달리 업로드 폴더를 자동 생성하지 않는다는 것도 발견해서 명시적으로 `mkdirSync` 추가함. 회귀 테스트(`worker/test/server.test.js`)로 확장자가 실제로 유지되는지 검증 추가.

**수정 후 검증**: 같은 캐릭터 이미지 + 10초 세그먼트로 재시도 → **`"status": "completed"`, 17크레딧 소모, 실제 결과 영상 확인 완료.**

## ⚠️ Higgsfield 자체 콘텐츠 검열 ("nsfw" 판정) 확인됨

같은 캐릭터 이미지로 5.4초 세그먼트(영상의 10~15.4초 구간)를 시도했을 때 `"status": "nsfw"`로 거부됨 — 크레딧은 소모 안 됨. 10초 구간(0~10초)은 같은 캐릭터로 정상 통과했으므로, 캐릭터 사진 자체의 문제가 아니라 **그 특정 구간의 원본 영상 내용에 대한 (아마도 오탐성) 자동 검열 판정**으로 보임. **같은 5.4초 구간을 2번 재시도했는데 2번 다 nsfw로 거부됨** — 우연이 아니라 이 영상의 이 구간 자체가 일관되게 검열에 걸리는 것으로 확인됨. 워커 코드 차원에서 대응할 방법은 없음 — Higgsfield의 자체 정책이라 세그먼트 위치/내용을 바꿔서 재시도하는 것 외엔 우회 수단 없음. 스펙 §9의 리스크 목록에 추가해둘 것.

## 🐛 실제로 발견한 버그 2: CLI 타임아웃 값이 너무 짧으면 성공한 결과를 놓침 (2026-09-16)

위 확장자 버그를 고친 뒤에도 **같은 종류의 무한 hang이 또 발생**함 (네트워크 활동 없이 45~60분+ 멈춤, Higgsfield 자체 job 목록에도 없음 — 즉 확장자 문제와는 별개의 원인). `generateFromSegment`의 `execFile` 호출에 타임아웃이 전혀 없어서 워커가 영원히 멈추는 게 근본 문제라고 판단, `execFile`의 `timeout` 옵션을 **20분**으로 추가함.

**그런데 이 20분 값 자체가 문제를 일으킴**: 재시도한 생성이 실제로는 성공했는데 (`higgsfield generate get`으로 확인: `"status": "completed"`, 17크레딧 실제 소모), 완료 시점이 시작 후 **20분 41초**로 우리가 설정한 20분 타임아웃보다 41초 늦게 끝남 — 그 사이에 우리 쪽에서 먼저 프로세스를 강제 종료해버려서 이미 성공한 결과를 못 받아옴 (크레딧만 날아갈 뻔함). 다행히 job id로 `higgsfield generate get <id>`를 직접 호출해서 결과 URL을 수동으로 복구함.

**최종 조치**: 타임아웃을 **40분**으로 늘림. 진짜 hang은 45~60분+ 동안 네트워크 활동이 전혀 없는 것으로 확인됐고, 정상 생성은 20분 안팎까지 걸릴 수 있으므로, 40분이면 정상 생성엔 충분한 여유를 주면서 진짜 hang은 계속 잡아낼 수 있음.

**교훈**: 이 CLI의 처리 시간 편차가 생각보다 크다 (몇 분 ~ 20분+). 타임아웃으로 인한 손실을 완전히 막으려면, 타임아웃으로 죽이기 전에 `higgsfield generate list`로 최근 job이 이미 완료됐는지 먼저 확인하는 안전장치를 추가하는 것도 고려할 만함 (현재는 구현 안 함, 향후 개선 후보).
