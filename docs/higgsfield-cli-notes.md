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

## "Genjutsu"라는 이름의 워크플로우는 없음 — ⚠️ 2026-09-21 정정: `workflow`가 아니라 `model`에 있었음

`higgsfield workflow list` 결과에 "genjutsu"라는 이름은 존재하지 않아서, 당시엔 웹 UI에서 봤던 "모션을 가져와서 다른 캐릭터로 재구성" 기능을 CLI 워크플로우 **`kling3_0_motion_control`** ("Kling 3.0 Motion Control")로 대체 확인하고 그걸로 파이프라인을 만들었음.

**2026-09-21 정정**: `higgsfield model list --video`(= `workflow`가 아니라 `model` 명령)로 보면 **Genjutsu가 실제로 존재함** — 별도의 두 모델로:

- `hf_mult_motion_control` — "Genjutsu" 표시, 원본 영상의 동작을 유지하며 인물(얼굴) 교체. 필수: `video_references` 정확히 1개, `image_references` 1개 이상. (`kling3_0_motion_control`과 파라미터 구조는 비슷하지만 별개 모델 — 어느 쪽이 더 나은지, NSFW 오탐 빈도가 다른지는 미검증)
- `hf_mult_replace_object` — "Genjutsu" 표시, 원본 영상 속 물건/의상 교체. 파라미터 구조 동일.

`model` 계열은 `workflow` 계열과 다른 CLI 서브커맨드를 씀: `higgsfield generate create <model> --mode ... --prompt "..." --video-references <path> --image-references <path> --wait` (참고: `higgsfield generate workflow <name> ...`가 아님). `higgsfield model get <job_type>`로 파라미터 확인 가능.

같은 조사에서 **`ad_multiplier`**(Seedance 2.5 기반, "Ad Multiplier")도 `model list --video`에 있음을 확인함 — 소스 영상(4~30초)의 모션·구도·오디오를 유지하며 사람/제품/의상을 한 번에 교체하는 모델. `mode video_edit` 사용 시 영상 레퍼런스 정확히 1개 필요. `hf_mult_motion_control` + `hf_mult_replace_object` 조합과 기능이 겹치는 부분이 있어, 셋 중 어느 게 NSFW 오탐이 적고 결과 품질이 좋은지는 실제 테스트로 비교 필요 (아직 미실행 — 더미 프롬프트로는 `generate cost`도 안 되고 실제 파일이 있어야 함, 크레딧은 소모 안 됨/974.5 유지 확인).

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

## ✅ CLI로 `ad_multiplier` / Genjutsu(`hf_mult_motion_control`, `hf_mult_replace_object`) 접근 확인 (2026-09-21)

`higgsfield workflow list`에는 없지만 **`higgsfield model list --video`에는 있음** — 별도의 CLI 서브커맨드 체계.

```bash
higgsfield model get <job_type>              # 파라미터 확인
higgsfield generate cost <job_type> --...    # 비용 조회 (무료, 실제 미디어 파일 필요 — 더미 프롬프트만으론 조회도 안 됨)
higgsfield generate create <job_type> --mode ... --prompt "..." --video-references <path> --image-references <path> --json
```

- `hf_mult_motion_control` — "Genjutsu" 표시, 모션 유지 + 얼굴 교체. `video_references` 정확히 1개, `image_references` 1개 이상 필수.
- `hf_mult_replace_object` — "Genjutsu" 표시, 물건/의상 교체. 파라미터 구조 동일.
- `ad_multiplier` (Seedance 2.5 기반) — `mode video_edit`일 때 `prompt` 필수, `video_references` 정확히 1개.

**비용**: 10초 세그먼트 기준 `hf_mult_motion_control`·`ad_multiplier` 둘 다 **70크레딧** — 기존에 쓰던 `kling3_0_motion_control`(10초=17크레딧)보다 약 4배 비쌈.

## ⚠️ 새로운 차단 사유 발견: `"status": "ip_detected"` (크레딧은 환불됨, ~20초 지연) (2026-09-21)

기존에 검증된 "본인 소유" 세그먼트(`segment0-paid-plan-success.mp4`, 10초) + 얼굴 샘플 이미지로 `ad_multiplier`(`mode: video_edit`)를 실제 실행했더니, NSFW가 아니라 **`"status": "ip_detected"`**로 거부됨. 소스 영상이나 레퍼런스 이미지의 어떤 요소(배경 음악, 브랜드/로고, 특정 인물과의 유사성 등)가 IP 감지 필터에 걸린 것으로 추정되나, API 응답에 구체적 사유는 나오지 않음. 같은 영상이 예전에 `kling3_0_motion_control`로는 통과했었다는 점에서, **모델(job_type)마다 콘텐츠 검열 기준이 다를 수 있음**을 시사함.

**크레딧 처리 (최초엔 정정 필요했던 부분)**: `higgsfield workspace list`로 바로 확인했을 땐 70크레딧이 빠진 것처럼 보여서 처음엔 "ip_detected는 환불 안 됨"으로 기록했었으나, `higgsfield account transactions`로 원장을 보니 spend(-70) 후 **약 20초 뒤 refund(+70)가 자동으로 들어와 net 0**이었음. 즉 `nsfw`/`failed`와 마찬가지로 `ip_detected`도 결국 무료 — 다만 반영에 지연이 있으니, 실패 직후 바로 `workspace list`만 보고 "돈이 나갔다"고 단정하지 말고 몇 초 후 `account transactions`로 실제 spend/refund 쌍을 확인할 것.

같은 조건(같은 영상+이미지)으로 병행 실행한 `hf_mult_motion_control`은 **정상 완료**(`status: completed`, 70크레딧 정상 차감, 결과 영상 `worker/data/test-hf_mult_motion_control-20260921.mp4`). 다만 이 세그먼트는 애초에 `kling3_0_motion_control`로도 통과했던 구간이라 NSFW 개선 여부를 증명하진 못함 — 아래 참고.

## ✅ `ip_detected` 원인 규명: 배경 음악(오디오) 문제였음, 영상/얼굴 문제 아님 (2026-09-21)

`ad_multiplier`(`mode: video_edit`)와 `hf_mult_motion_control`의 파라미터를 비교해보니 뚜렷한 차이가 하나 있었음: `hf_mult_motion_control`은 `generate_audio: false`로 오디오를 아예 처리하지 않는 반면, `ad_multiplier`의 `video_edit` 모드는 `generate_audio: true`로 원본 오디오를 그대로 분석·보존함. 같은 얼굴 이미지를 썼는데 오디오를 안 건드리는 쪽만 통과했다는 점에서 오디오(원본 영상의 배경 음악)가 원인일 가능성을 의심함.

**검증**: 아까 `ip_detected`가 났던 것과 동일한 5.4초 구간에서 `ffmpeg -an`으로 오디오만 제거한 뒤 같은 `ad_multiplier` 호출을 다시 실행 → **`status: completed`, 38.03크레딧 정상 차감(환불 없음, 진짜 성공)**. 결과 영상: `worker/data/test-ad_multiplier-muted-20260921.mp4`.

**결론**: `ip_detected`는 영상 내용이나 얼굴 이미지가 아니라 **원본 영상의 배경 음악(저작권 있는 트렌딩 음악일 가능성)** 때문이었음이 확인됨. `ad_multiplier`를 쓸 때는 **소스 영상의 오디오를 미리 제거(`ffmpeg -an`)하고 넣는 것을 표준 전처리로 삼을 것**. 이렇게 하면 `ad_multiplier` 한 번의 호출로 인물 교체 + 물건/의상 교체를 동시에 처리할 수 있어(Genjutsu 두 모델을 순차 호출하는 것보다 단순하고 비용도 절반), `hf_mult_motion_control` 단독 사용보다 이쪽이 최종 목표(얼굴+물건/의상 교체, 나중엔 음성/대본까지 교체)에 더 부합함 — 어차피 장기 목표가 원본 오디오를 새 목소리로 교체하는 것이므로 원본 오디오를 버리는 것 자체는 손해가 아님.

## ✅ 진짜 NSFW 비교 테스트 결과: `hf_mult_motion_control`이 통과함 (2026-09-21)

예전에 `kling3_0_motion_control`로 **2번 재시도 모두 `nsfw`로 거부됐던 동일한 5.4초 구간**(원본 15.433초 영상의 10~15.4초, `worker/data/jobs/d50722e3-.../source.mp4`에서 잘라냄 → `worker/data/test-nsfw-segment-10to15s.mp4`)을 같은 얼굴 이미지로 `hf_mult_motion_control`에 넣어 재시도함.

**결과: `"status": "completed"`, 35크레딧 정상 차감(환불 없음), 실제 결과 영상 확보** (`worker/data/test-hf_mult_motion_control-nsfw-segment-20260921.mp4`).

**의미**: 같은 콘텐츠가 `kling3_0_motion_control`에서는 일관되게 막혔는데 `hf_mult_motion_control`에서는 통과함 — 모델마다 콘텐츠 검열 기준이 실제로 다르다는 가설이 이 케이스에서는 확인됨. 다만 **표본 1개**이므로 일반화는 아직 이름. 결과 영상 품질(실제로 자연스러운지)은 육안 확인이 아직 안 됨 — 다음 단계로 확인 필요.

**✅ 2026-09-21 완료 — 워커 코드 교체함.** 결과 영상 품질 육안 확인 후 사용자 승인받아 `worker/src/pipeline/generate.js`를 `kling3_0_motion_control`(`generate workflow`) → `hf_mult_motion_control`(`generate create`, `--mode std` 파라미터 없음)로 교체함. `TERMINAL_STATUSES`에 `ip_detected`도 추가(§ 위 참고 — 결국 무료지만 job 목록 조회 시 종결 상태로 인식은 되어야 함). 관련 테스트(`worker/test/generate.test.js`) 전부 수정 후 28개 테스트 통과 확인. 비용은 10초 기준 17→70크레딧으로 오름 — 실사용 시 크레딧 소모 속도 재계산 필요.

## ✅ 2026-09-21 완료 — 2차 교체: `hf_mult_motion_control` → `ad_multiplier` + 오디오 제거 전처리

위 "ip_detected 원인 규명" 섹션의 결론(배경 음악이 원인, `ffmpeg -an`으로 해소)에 따라 `worker/src/pipeline/generate.js`를 다시 교체함:

- `generateFromSegment`이 이제 Higgsfield 호출 전에 `ffmpeg -y -i <segment> -an -c:v copy <muted-segment>`로 세그먼트를 먼저 음소거함 (원본 세그먼트 파일 자체는 그대로 두고, 같은 폴더에 `muted-` 접두사 붙은 별도 파일 생성).
- Higgsfield 호출을 `hf_mult_motion_control`(`generate create hf_mult_motion_control --video-references ... --image-references ...`)에서 `ad_multiplier`(`generate create ad_multiplier --mode video_edit --prompt '' --video-references <muted-segment> --image-references ...`)로 교체.
- **프롬프트는 반드시 1자 이상** (2026-09-22 E2E 실행에서 확인 — 처음엔 `--prompt ''`로 넣었다가 정정함): CLI는 `--prompt` 플래그가 없으면 `Missing required params: prompt`로 클라이언트에서 거부하고, 빈 문자열은 CLI는 통과하지만 **서버가 `Error: prompt: String should have at least 1 character`로 거부**함. 성공했던 9/21 잡(`9bfab71d-...`)이 `generate list`/`generate get`에서 `params.prompt: null`로 보이는 건 **API가 프롬프트를 되돌려주지 않기 때문**이지 빈 프롬프트였다는 뜻이 아님 — 그날 실제로 쓴 문구는 기록이 없어 복원 불가. 코드에는 자체 문구(`FACE_SWAP_PROMPT`, "레퍼런스 이미지의 인물로 교체, 모션·구도·조명·배경은 유지")를 상수로 넣어둠.
- 관련 테스트(`worker/test/generate.test.js`) 전부 수정 — 모든 테스트에서 호출 순서가 `ffmpeg`(음소거) → `higgsfield` → `curl`로 하나 늘어남. 28개 테스트 통과 확인.
- 워커 코드 경로로의 실제 성공은 아직 없음 — 아래 2026-09-22 E2E 시도 참고.

## 2026-09-22 E2E 시도 — 네트워크로 워커 경로 실패, 미디어 ID 우회 생성은 성공

**소재**: Pexels 8143138(화장품 리뷰, 17.04초, 오디오 없음, 무료 라이선스) + AI 생성 얼굴(`worker/data/face_sample/ai-generated-woman-20260922.jpg`). yt-dlp는 Pexels **페이지 URL은 Cloudflare 403**으로 실패하고, **CDN 직링크**(`https://videos.pexels.com/video-files/8143138/8143138-hd_1366_720_25fps.mp4`)는 generic 추출기로 정상 처리됨 — 워커 `youtubeUrl`에 직링크를 넣으면 다운로드 단계는 그대로 통과함.

**워커 잡 `4dde39a7`**: 다운로드·분할·음소거는 정상. 생성 단계에서 `Error: request failed (no response received)` ×2, 재시도 2회도 동일. 진단:
- 업로드 속도 측정 ~96KB/s (1MB POST에 10초). `higgsfield upload create`로 1MB 세그먼트는 25초 걸려 성공, 857KB PNG는 `Failed to upload media bytes`.
- 업로드 목록을 보면 세그먼트 영상은 매번 올라갔고 **그 다음 요청(이미지 업로드 또는 create)에서 끊김**. Higgsfield 잡은 하나도 생성되지 않았고 크레딧 소모 없음.
- CLI에 업로드/HTTP 타임아웃이나 재시도 옵션은 없음(`--wait-timeout`, `--wait-interval`은 wait 폴링용).

**우회**: 이미 올라간 ID로 `higgsfield generate create ad_multiplier --mode video_edit --prompt "<FACE_SWAP_PROMPT>" --video-references <video-id> --image-references <image-id> --json` (`--wait` 없이) → 즉시 job id 반환, 약 24분 뒤 `completed`, **70크레딧 차감**(`account transactions`로 확인, 환불 없음). 결과 `worker/data/test-ad_multiplier-pexels8143138-aiface-20260922.mp4` (9.7초, 1322x696, 비디오 스트림만 — 소스에 오디오가 없었으므로 `generate_audio: true`여도 오디오 없음). 비교 프레임 `worker/data/source-2s.jpg` / `result-2s.jpg`.

**품질**: 얼굴만이 아니라 인물 전체(머리 타월→머리카락, 상의→가운)가 레퍼런스 인물로 바뀌고, 손에 든 제품·손동작·욕실 배경·구도는 유지됨. "Replace the person…" 프롬프트대로 동작한 것으로, 인물 교체 목적엔 적합. 얼굴만 바꾸고 의상은 유지하고 싶다면 프롬프트를 "Replace only the face…" 식으로 바꿔 비교 필요(미테스트).

**특이사항**: CLI는 create 즉시 job id를 돌려줬지만 서버 `created_at`은 약 20분 뒤(14:49Z)로 기록됨 — 큐 대기 후 시각이 찍히는 듯. `generate get`은 그 사이 빈 응답을 돌려줌. `recoverTimedOutJob`의 `created_at >= startedAt` 비교에는 영향 없음(더 늦은 시각).

## ✅ 2026-09-23 — `ad_multiplier`로 인물 + 제품 동시 교체 성공 (2단계)

같은 muted seg0(`b217472c`) + 같은 AI 얼굴(`413765c7`) + 아이라이너 사진(`0db232f3`, Pexels 7256089 크롭)을 `--image-references` 2개로 넘기고, 프롬프트에 "첫 레퍼런스 인물로 교체 + 들고 있는 제품을 두 번째 레퍼런스 제품으로 교체"를 명시:

```bash
higgsfield generate create ad_multiplier --mode video_edit \
  --prompt "Replace the person in the video with the person from the first reference image, and replace the product they are holding with the product from the second reference image. Keep the original motion, framing, lighting, and background unchanged." \
  --video-references <video-id> --image-references <person-id> --image-references <product-id> --json
```

- 결과 `completed`, **70크레딧** — 인물만 교체할 때와 동일. 제품 교체를 얹어도 추가 비용 없음. 생성 시간 약 3분(9/22의 24분보다 훨씬 빠름 — 큐 상황 차이로 추정).
- 결과 `worker/data/test-ad_multiplier-pexels8143138-aiface-eyeliner-20260923.mp4`. 흰 병 → 검정 리퀴드 아이라이너 펜(펜촉 표현됨), 손가락 그립도 펜 모양에 맞게 바뀜, 인물·배경·동작은 9/22 결과와 동일하게 유지.
- 레퍼런스 순서 = 인자 순서로 동작함(첫 `--image-references`가 "first reference image"). 제품 사진에 브랜드명이 있으면 `ip_detected` 위험이 있으니 무브랜드 사진을 쓰거나 로고를 잘라낼 것 — 첫 후보(Pexels 2693644, "venus" 각인)는 그래서 제외함.

## ✅ 2026-09-23 — 음성(TTS) 조사 및 보이스오버 테스트 (3단계)

**모델 지형** (`higgsfield model list --json`, 총 91개):
- TTS: `text2speech_v2`(variant elevenlabs/minimax/seed_speech/vibe_voice/cozy_voice, 프리셋 음성 필수, **0.3크레딧**/문장 몇 개), `qwen_audio_tts`(language ko 포함, **0.03크레딧**), `inworld_text_to_speech`(음성 이름을 직접 지정, 한국어 Hyunwoo/Minji/Seojun/Yoona), `mirelo_text_to_audio`, `seed_audio`, `sonilo_music`.
- 립싱크/토킹헤드 전용 모델: **없음**. `ad_multiplier`·`seedance_2_5`·`wan3_0`은 `--audio-references`를 받지만(비용 동일 70) 입 모양을 오디오에 맞추는지는 **미검증**.
- 대본 생성용 LLM: **없음** (`brain_activity`는 "Virality Predictor").
- `dubbing`(target_language 필수), `voice_change`(voice_id 필수) — 원본 영상에 말소리가 있어야 함. Pexels 무음 소스엔 해당 없음.
- 음성 메타: `voices list`/`voices get`은 id·name·voice_type만 줌. 성별·나이는 TTS 잡 응답의 `params.voice`(gender/age/supported_models)에만 나옴.

**실행**:
```bash
higgsfield generate create text2speech_v2 --prompt "<대본>" --variant elevenlabs \
  --voice-id a00bc7f3-0236-5e76-ac65-90137ce0f5a4 --voice-type preset --wait --json
```
→ 8초 만에 `completed`, 0.3크레딧, `result_url`에 mp3(44.1kHz 모노, 10.48초). 음성 "Brielle"은 응답상 female/old. 결과 `worker/data/voiceover-brielle-20260923.mp3`.

**영상에 얹기** (생성 영상은 비디오 스트림만 있으므로 음성이 유일한 오디오 트랙):
```bash
ffmpeg -y -i final.mp4 -i voiceover.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -af apad -shortest final-voiced.mp4
```
`apad`+`-shortest` 조합으로 음성이 짧으면 무음 패딩, 길면 영상 길이에서 잘림 → 영상 길이 불변. 결과 `worker/data/test-ad_multiplier-pexels8143138-aiface-eyeliner-voiced-20260923.mp4`. 이 두 명령이 그대로 `worker/src/pipeline/voiceover.js`에 들어감.

**교훈(9/22)**: 업로드가 느린 환경에서는 워커의 파일 경로 전달 방식이 취약함. 대안으로 (a) 워커가 `upload create`로 먼저 올리고 ID로 `generate create`를 호출하도록 분리하면 실패 지점을 좁히고 재시도도 단계별로 할 수 있음, (b) 세그먼트 파일 크기 축소. 둘 다 아직 미구현 — 안정 네트워크에서 현 코드로 먼저 성공을 확인한 뒤 판단.
