# 작업 이어가기 — 2026-09-23 세션 정리

## 오늘 한 것

1. **스코프 변경 (사용자 결정)**: 9/22 "1단계(인물 교체)만"에서 **2단계(제품 교체) 포함**으로 바꿈. 3단계(음성·대본)는 여전히 장기 목표. 프로젝트 `CLAUDE.md` 확정 방향 문구 갱신함.

2. **2단계 구현 (코드 반영, 미커밋)**:
   - `worker/src/server.js`: `POST /jobs`가 `upload.fields`로 `characterImages`(필수 1) + `productImages`(선택 1)를 받음. 잡에 `productImagePaths`(없으면 `[]`) 저장 (`db.js`).
   - `worker/src/pipeline/generate.js`: 옵션 `productImagePath`가 있으면 `--image-references`를 인물, 제품 순으로 2개 넘기고 프롬프트를 `FACE_AND_PRODUCT_SWAP_PROMPT`로 분기. 없으면 기존 `FACE_SWAP_PROMPT` 경로 그대로.
   - `worker/src/pipeline/jobRunner.js`: `runJob`/`retrySegment` 둘 다 `job.productImagePaths?.[0]`를 넘김.
   - `web/`: `ProductInputNode`("제품 입력 (선택)", 주황 엣지) 추가, `Canvas.tsx`에 상태·노드·엣지 연결, `workerApi.createJob(url, characterFile, productFile | null, opts)`로 시그니처 변경.
   - 테스트: 워커 32개(신규 4: 제품 레퍼런스 2개 전달·프롬프트 분기·서버 필드 수신·미입력 시 빈 배열), 웹 8개(신규 1), `tsc --noEmit` 통과. 브라우저에서 노드 렌더 확인 (`worker/data/canvas-with-product-node-20260923.png`).

3. **2단계 실제 생성 성공 (CLI 우회)**:
   - 제품 이미지: Pexels 7256089(손에 든 검정 리퀴드 아이라이너, 무브랜드) → 펜 부분만 크롭 `worker/data/product_sample/eyeliner-pexels7256089-20260923.jpg`. 첫 후보였던 2693644는 "venus" 브랜드명이 찍혀 있어 IP 감지 위험으로 제외.
   - 업로드된 미디어 ID(영상 `b217472c`=muted seg0, 인물 `413765c7`, 제품 `0db232f3`)로 `generate create ad_multiplier --mode video_edit --prompt "<FACE_AND_PRODUCT_SWAP_PROMPT>" …` 실행 → 약 3분 만에 `completed`, **70크레딧**(잔여 691.47). 인물만 교체할 때와 비용 동일 — 제품 교체 추가 비용 없음.
   - 결과: `worker/data/test-ad_multiplier-pexels8143138-aiface-eyeliner-20260923.mp4` (9.7초). 프레임 `worker/data/result2-{2,5,8}s.jpg`.
   - **품질**: 흰 화장품 병이 검정 아이라이너 펜으로 바뀌고(펜촉까지 표현), 인물은 9/22와 같은 AI 얼굴로 교체, 동작·구도·배경 유지. 손가락 형태가 병을 잡던 모양에서 펜을 잡는 모양으로 자연스럽게 조정됨. 2단계도 인물 교체와 같은 수준으로 잘 나옴.

4. **3단계(음성 대본) 구현 — 보이스오버 방식 (같은 날 이어서, 사용자 결정)**:
   - 조사: Higgsfield에 TTS는 있음(`text2speech_v2` ElevenLabs 등 0.3크레딧, `qwen_audio_tts` 0.03크레딧, `inworld` 한국어 프리셋). **대본 생성 LLM은 없음**(`brain_activity`는 바이럴 예측기), **립싱크 전용 모델도 없음**. `dubbing`/`voice_change`는 원본에 말소리가 있어야 해서 무음 소스엔 무관. `ad_multiplier`가 `--audio-references`를 받긴 하나 입 모양을 맞춰주는지는 미검증.
   - 사용자 결정: 대본은 노드에 직접 입력 / 음성은 **보이스오버만**(립싱크 없음) / 영어 여성 음성.
   - 워커: `worker/src/pipeline/voiceover.js` 신규 — `synthesizeSpeech(script, mp3Path)`(text2speech_v2, 기본 음성 `DEFAULT_VOICE`=Brielle/elevenlabs)와 `muxVoiceover(video, mp3, out)`(ffmpeg `-map 0:v -map 1:a -c:v copy -c:a aac -af apad -shortest` — 영상 길이에 맞춰 음성을 패딩/트림). `jobRunner`는 병합 뒤 `job.script`가 있으면 상태 `voiceover` → `voiceover.mp3` → `final-voiced.mp4`를 resultPath로. 대본 없으면 기존과 동일. `retrySegment` 경로(`maybeFinishJob`)도 같은 마무리 단계를 탐. `POST /jobs`는 `script` 텍스트 필드(선택, trim, 공백이면 null) 수신.
   - 웹: `ScriptInputNode`(textarea, 파란 엣지) + `VoiceoverStatusNode`("음성": 대본 없으면 "건너뜀", 진행 중 "음성 합성 중") 추가. 흐름이 생성 → 병합 → **음성** → 결과로 한 칸 늘어남. `createJob`은 인자가 늘어나 객체 시그니처 `createJob({ youtubeUrl, characterImage, productImage?, script? }, opts)`로 리팩터.
   - 테스트: 워커 38개(신규 6), 웹 9개(신규 2), tsc 통과. UI 렌더 확인 `worker/data/canvas-with-voiceover-node-20260923.png`.
   - **실제 테스트**: TTS 1회(0.3크레딧, 8초 완료, 10.5초 mp3, `worker/data/voiceover-brielle-20260923.mp3`) → 2단계 결과 영상에 ffmpeg로 얹은 데모 `worker/data/test-ad_multiplier-pexels8143138-aiface-eyeliner-voiced-20260923.mp4`(h264+aac, 9.7초). 워커 코드 경로로는 아직 안 돌림(아래 참고).
   - 음성 선택: `voices list`/`voices get`엔 성별·나이 메타가 없고 TTS 잡 응답(`params.voice`)에만 나옴 — Brielle은 "female, old"로 표시됨. 더 젊은 음성으로 바꾸려면 몇 개 후보를 0.3크레딧씩 들어보고 `DEFAULT_VOICE`만 바꾸면 됨(UI에서 음성 선택은 아직 없음).

5. **4단계(프롬프트 보정) 구현 + UI 리디자인 (같은 날 이어서, 사용자 요청)**:
   - 모델 선정(무료 비용 조회, 10초 기준): `kling_video_edit` std 15/pro 20, `flux_3_video_edit` 15, `gemini_omni_flash_1_1` edit 30, `ad_multiplier` video_edit 70, `seedance_2_5` 75. **Kling std를 먼저 실행했으나 사유 없이 `failed`**(13.5 spend→refund, 실비용 0). **`flux_3_video_edit`로 재시도 → 약 1분 만에 `completed`, 실차감 9.71크레딧.** 워커 코드는 FLUX로 확정.
   - 프롬프트: "골든아워처럼 따뜻하고 부드러운 시네마틱 조명, 인물·아이라이너·동작·욕실은 그대로" → 결과 `worker/data/test-flux3edit-warm-eyeliner-20260923.mp4`(9.7초, 1280x672). 프레임 `result4-2s.jpg`, `result4-8s.jpg`: 창가 골든아워 빛이 얹혔고 인물·제품·동작·배경 유지됨. 편집 대상은 2단계 결과 영상(Higgsfield에 재업로드, media id `661cf181`).
   - 4단계 합본 데모(보정 영상 + 기존 나레이션 mux): `worker/data/test-4stages-eyeliner-warm-voiced-20260923.mp4`.
   - 워커: `worker/src/pipeline/edit.js` 신규 — `editVideo(video, prompt, out)`(`generate create flux_3_video_edit --prompt … --video-references …`, `generate.js`의 `recoverTimedOutJob`·`GENERATE_TIMEOUT_MS`를 export해서 재사용). `jobRunner`의 마무리 단계가 `finishVideo`로 통합: 병합 → (editPrompt 있으면 상태 `editing`, `final-edited.mp4`) → (script 있으면 `voiceover`, `final-voiced.mp4`). 순서가 중요: 보정은 영상을 다시 렌더하므로 나레이션보다 먼저. `POST /jobs`에 선택 `editPrompt` 필드.
   - **UI 리디자인** (Arcads 스크린샷 톤): 순검은 캔버스 + 점 그리드, 작은 카드에 **썸네일**(원본 영상은 mp4 직링크면 `<video>` 미리보기, 인물/제품은 선택한 파일의 object URL), 대본·프롬프트는 노트 카드, 단계 카드는 한 줄 상태. 엣지 색: 미디어 초록·텍스트 노랑·파이프라인 회색, **진행 중인 단계로 들어가는 엣지만 점선 애니메이션**(reduced-motion 존중). 실행 버튼은 하단 중앙 플로팅 필 "영상 만들기". 노드 컴포넌트를 `NodeCard`(공통 셸) + `VideoInputNode`/`ImageInputNode`/`TextInputNode`/`StageNode`/`ResultNode`로 통합하고 기존 6개 개별 노드 파일 삭제. 스크린샷 `worker/data/canvas-redesign-empty-20260923.png`, `canvas-redesign-filled-20260923.png`.
   - 테스트: 워커 43개(신규 5), 웹 9개, tsc 통과.
   - 비용 메모: TTS는 비용 조회 0.3이었지만 실차감 0.45("Voiceover" 항목). FLUX 편집은 조회 15, 실차감 9.71. 조회값은 상한으로 보면 됨.

6. 9/22 대비 네트워크는 여전히 느림(업로드 ~77KB/s). 8.5KB 제품 이미지 업로드는 4초로 문제없었지만 1MB 세그먼트는 여전히 위험 → 워커 경로 E2E는 오늘도 시도 안 함.

## ⚠️ 지금 실제 코드 상태

- 워커/웹 모두 1~4단계 코드가 들어가 있고 워커는 재시작해서 새 코드로 4000 포트에 떠 있음. 웹 dev 서버(3000)는 핫리로드로 반영됨. 3단계까지 커밋됨(`12bb26b`, `b7b716e`, `c49dd8a`), 4단계+리디자인은 미커밋.
- **워커 코드 경로(파일 업로드 포함)로 실제 성공한 적은 1~4단계 모두 아직 없음.** 성공은 전부 CLI 우회(사전 업로드된 ID)와 로컬 ffmpeg. 세그먼트 1(10–17초), 병합, 워커의 editing/voiceover 단계는 한 번도 실제로 실행 안 됨.

## 다음에 할 일 (우선순위 순)

1. **안정적인 네트워크에서 워커 E2E** — UI에서 Pexels 직링크 + `face_sample/ai-generated-woman-20260922.jpg` + `product_sample/eyeliner-…jpg` + 보정 프롬프트 + 대본으로 "영상 만들기" → 세그먼트 2개 생성 → 병합 → 보정 → 음성 → 완성 영상 카드에서 저장까지 최초 확인 (약 120~140 + 편집 ~15 + TTS ~0.5 크레딧). 이게 되면 1~4단계와 UI 검증이 한 번에 끝남. 실행 전 1MB 업로드 속도 재측정(300KB/s 이상 권장). 사용자가 9/23에 "E2E는 나중에"로 보류함.
2. 실패 시 `POST /jobs/:id/segments/:i/retry`로 세그먼트별 재시도 — 이제 retry도 제품 이미지를 같이 넘김.
3. (선택) 업로드 내성 — 워커가 `upload create`로 먼저 올려 ID를 받고 `generate create`는 ID로 호출하도록 분리하면 재시도 단위가 작아짐. 안정 네트워크에서 1번 먼저 확인한 뒤 판단.
4. (선택) 프롬프트 튜닝 — 지금 문구는 인물 "전체"를 바꿈(의상까지). 얼굴만 바꾸고 의상 유지가 필요하면 "Replace only the face…" 변형을 같은 소재로 비교(70크레딧).
5. 비용: 10초 세그먼트 70크레딧 고정(제품 교체 유무 무관). 17초 영상 1개 ≈ 120~140크레딧.

## 다음 세션 시작 시 프롬프트

```
docs/session-handoff-2026-09-23.md 읽고 정리된 순서대로 이어서 진행해줘.
```
