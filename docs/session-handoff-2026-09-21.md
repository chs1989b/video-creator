# 작업 이어가기 — 2026-09-21 세션 정리

## 오늘 조사/검증한 것 (전부 CLI 수동 테스트, 코드 반영은 별도 — 아래 "지금 실제 코드 상태" 참고)

1. **NSFW 반복 문제의 원인을 재조사**: `higgsfield workflow list`에는 없었지만 `higgsfield model list --video`에 실제 "Genjutsu"가 존재함을 발견 — `hf_mult_motion_control`(모션 유지+얼굴 교체), `hf_mult_replace_object`(물건/의상 교체) 두 모델. CLI 서브커맨드도 다름 (`generate workflow`가 아니라 `generate create`).

2. **모델 비교 테스트** (모두 같은 본인 소유 소스 영상 + 같은 얼굴 이미지로 조건 통일):
   - `kling3_0_motion_control`(기존 모델): 과거 2번 재시도 모두 `nsfw`로 거부됐던 5.4초 구간 — 이번엔 재테스트 안 함(기존 기록 참고)
   - `hf_mult_motion_control`: 위와 동일한 5.4초 구간 재시도 → **정상 통과** (`completed`, 35크레딧)
   - `ad_multiplier`(오디오 포함 원본): → **`ip_detected`로 거부** (크레딧은 spend 후 자동 refund, net 0)
   - `ad_multiplier`(오디오 제거 버전, `ffmpeg -an`): → **정상 통과** (`completed`, 38.03크레딧, 환불 없는 진짜 성공)

3. **결론**: `ip_detected`는 영상 내용이나 얼굴이 아니라 **원본 영상의 배경 음악(저작권)** 때문이었음. `ad_multiplier`는 오디오만 제거하고 쓰면 정상 작동하며, 얼굴+물건/의상 교체를 **한 번의 호출**로 처리 가능(Genjutsu 조합은 두 번 호출 필요, 비용도 2배). 장기 목표(음성·대본 교체)를 고려하면 원본 오디오는 어차피 버릴 예정이라 오디오 제거가 손해가 아님. → **`ad_multiplier` + 오디오 제거 전처리가 최종적으로 더 적합한 방향으로 판단**.

4. Higgsfield에 `voice_change`, `dubbing` 모델이 별도로 존재함을 확인 (장기 목표용, 아직 미테스트).

5. 2회차 수업 리뷰 메일 작성 완료 (별도 보관 — 이 문서에는 포함 안 함).

상세 로그·정확한 명령어: `docs/higgsfield-cli-notes.md`.

## ⚠️ 지금 실제 코드 상태 (위 조사 결과와 다름 — 헷갈리지 말 것)

- `worker/src/pipeline/generate.js`는 **`hf_mult_motion_control` 단독** 호출만 함 (1차 교체까지만 반영됨, `TERMINAL_STATUSES`에 `ip_detected` 추가됨, 테스트 28개 통과 확인된 상태). **`ad_multiplier`로는 아직 안 바뀜.**
- 오디오 제거 전처리(`ffmpeg -an`)는 코드에 없음 — 오늘 진단 테스트는 터미널에서 수동으로 한 번 돌려본 것뿐, 파이프라인에 통합 안 됨.
- 물건/의상 교체 기능은 코드에 전혀 없음 (`hf_mult_replace_object`도, `ad_multiplier`의 의상/물건 교체 프롬프트도 아직 안 써봄).
- 프론트엔드(캔버스 UI) ↔ 백엔드 연동은 2026-09-15 시점 "실패 경로 기준"으로만 검증됨 — 실제 성공적인 생성 결과가 UI 끝까지 이어져서 확인된 적은 아직 없음.

## 다음에 할 일 (우선순위 순)

1. **워커 코드를 `hf_mult_motion_control` → `ad_multiplier`로 교체 + 오디오 제거 전처리 추가** — 소스 세그먼트를 Higgsfield에 넘기기 전에 `ffmpeg -an`으로 음소거하는 단계를 파이프라인(`generate.js` 또는 `segment.js`)에 통합
2. 위 상태로 "사용 권한 있는 영상 1개, 30초 이하, 인물 교체"를 다운로드→분할→(오디오 제거)→생성→병합까지 실제 성공으로 E2E 테스트
3. 완성된 백엔드를 캔버스 UI에 연결해서, UI에서 버튼을 눌러 실제 결과 영상을 받는 흐름을 최초로 성공시키기
4. (여유 있으면) `ad_multiplier` 프롬프트에 물건/의상 교체 지시까지 추가해서 한 번에 되는지 테스트
5. 비용 재계산 — 10초 기준 기존 17크레딧 → `hf_mult_motion_control`/`ad_multiplier` 70크레딧대(짧은 구간은 비례 축소)로 올랐으므로 실사용 예산 재검토

## 다음 세션 시작 시 프롬프트 (그대로 복사해서 쓰면 됨)

```
docs/session-handoff-2026-09-21.md 읽고 정리된 순서대로 이어서 진행해줘.
```
