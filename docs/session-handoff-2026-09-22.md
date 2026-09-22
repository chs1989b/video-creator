# 작업 이어가기 — 2026-09-22 세션 정리

## 오늘 한 것

1. **워커 2차 교체 완료 (코드 반영)**: `worker/src/pipeline/generate.js`를 `hf_mult_motion_control` → `ad_multiplier`(`--mode video_edit`)로 교체하고, Higgsfield 호출 전에 `ffmpeg -an`으로 세그먼트를 음소거하는 전처리(`muted-<segment>.mp4`)를 추가함. 테스트 28개 통과. **아직 커밋 안 됨** (9/21 작업분 포함 전부 working tree에 있음 — `git status` 참고).

2. **프롬프트 버그 발견·수정**: 처음엔 `--prompt ''`로 넣었는데 서버가 `prompt: String should have at least 1 character`로 거부함. API가 프롬프트를 되돌려주지 않아(`generate get`에서 항상 `prompt: null`) 9/21 성공 잡의 실제 문구는 복원 불가 → 자체 문구를 `FACE_SWAP_PROMPT` 상수로 넣음. 상세: `docs/higgsfield-cli-notes.md` 2026-09-22 섹션.

3. **저작권 없는 테스트 소재 확정**:
   - 영상: Pexels 8143138 "Video of Woman Doing a Product Review" (17.04초, 무료 라이선스, 오디오 없음). 워커에 넘길 URL은 **직접 CDN 링크** `https://videos.pexels.com/video-files/8143138/8143138-hd_1366_720_25fps.mp4` (Pexels 페이지 URL은 Cloudflare가 yt-dlp를 차단함, `/download/video/8143138/?w=1366&h=720` 형태는 리다이렉트로 동작).
   - 얼굴: AI 생성 얼굴(this-person-does-not-exist.com, `gender=female&etnic=white`), 상단 워터마크 잘라냄 → `worker/data/face_sample/ai-generated-woman-20260922.jpg`. 실존 인물이 아니라 초상권 이슈 없음 — 사용자가 Pexels 실제 인물 사진 대신 이걸 선택함.

4. **워커 E2E는 네트워크 때문에 실패, 우회 생성은 성공**:
   - 워커 잡 `4dde39a7`: 다운로드 → 분할(0–10초 / 10–17.04초) → 음소거까지 정상. 생성 단계에서 두 세그먼트 모두 `Error: request failed (no response received)`. 재시도 2회도 동일. 원인은 **이 네트워크의 업로드 속도(~96KB/s 측정)** — 1MB 세그먼트 업로드에 25초, 857KB PNG는 `Failed to upload media bytes`. Higgsfield 쪽 잡은 생성 안 됐고 크레딧 소모 없음.
   - 우회: 이미 올라간 미디어 ID(영상 `b217472c-…`=muted seg0, 이미지 `413765c7-…`)로 `generate create`를 직접 실행(`--wait` 없이) → **`completed`, 70크레딧 차감**. 결과: `worker/data/test-ad_multiplier-pexels8143138-aiface-20260922.mp4` (9.7초, 1322x696, 비디오만). 비교 프레임: `worker/data/source-2s.jpg` vs `worker/data/result-2s.jpg`.
   - **품질 육안 확인**: 얼굴뿐 아니라 인물 전체(머리 타월→머리카락, 상의→가운)가 레퍼런스 인물로 바뀌고, 손에 든 제품·손동작·욕실 배경·구도는 그대로 유지됨. 인물 교체 목적엔 충분히 좋은 결과.
   - 특이사항: `generate create`는 CLI가 즉시 job id를 돌려줬는데 서버 `created_at`은 약 20분 뒤(14:49Z)로 기록됨 — 큐 대기 시간이 `created_at`에 포함되는 것으로 보임. `recoverTimedOutJob`의 "created_at >= startedAt" 비교에는 문제 없음(더 늦은 시각이므로).

5. **스코프 결정 (사용자 확인)**: 사용자가 3단계 시스템(①인물 교체 ②제품 교체 ③음성·대본)을 제시했으나, **이번 과정은 ①만** 유지하기로 함. ②는 `ad_multiplier`가 한 호출로 지원하므로 나중에 프롬프트+이미지 1개 추가로 가능(아직 코드/UI 없음), ③은 CLAUDE.md대로 장기 목표.

## ⚠️ 지금 실제 코드 상태

- `generate.js`: `ad_multiplier` + 음소거 전처리 + `FACE_SWAP_PROMPT` — **코드 경로로 실제 성공한 적은 아직 없음** (성공은 수동 CLI 우회). 세그먼트 1과 병합 단계는 이번에 실행조차 못 함.
- 워커는 재시작해서 새 코드로 4000 포트에 떠 있음(9/17부터 떠 있던 구버전 프로세스는 종료함). 웹 dev 서버는 9/15부터 3000 포트에 그대로.
- `worker/data/db.json`에 오늘 잡 `4dde39a7`이 `failed`로 남아 있음(두 세그먼트 모두 failed). 안정적인 네트워크에서 `POST /jobs/4dde39a7…/segments/0/retry`, `…/1/retry`를 순서대로 치면 이어서 진행 가능(세그먼트 파일은 그대로 있음).

## 다음에 할 일 (우선순위 순)

1. **안정적인 네트워크에서 워커 E2E 성공시키기** — 위 `4dde39a7` 잡의 세그먼트 0, 1을 retry 엔드포인트로 재시도(각 ~70크레딧, 세그먼트 1은 7초라 더 적음) → 병합까지 확인. 또는 새 잡을 UI에서 생성해서 3번을 겸함.
2. 워커 코드 경로 성공 후 → **캔버스 UI에서 같은 입력으로 실행해 끝까지 성공하는 흐름 최초 확인** (`Canvas.tsx`는 자기가 만든 잡만 추적하므로 UI 검증엔 새 잡 생성이 필요 = 추가 크레딧).
3. (선택) 업로드 실패 내성 — `no response received`/`Failed to upload media bytes` 시 CLI 호출을 2~3회 자동 재시도하는 로직. 링크가 이 정도로 느리면 효과 불확실하니, 안정 네트워크에서 1번을 먼저 확인한 뒤 판단.
4. (선택) 세그먼트 파일 크기 축소(현재 10초 ≈ 1MB, libx264 기본 CRF) — 업로드 부담 완화용. ad_multiplier 출력이 720p라 720p 이상은 의미 없음.
5. 비용 재계산 — 10초 70크레딧 확정. 17초 영상 1개 = 약 110~120크레딧. 잔여 761.47.
6. **커밋** — 사용자가 요청하면 9/21+9/22 작업분(generate.js, merge.js, 테스트, docs)을 정리해서 커밋.

## 다음 세션 시작 시 프롬프트

```
docs/session-handoff-2026-09-22.md 읽고 정리된 순서대로 이어서 진행해줘.
```
