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
