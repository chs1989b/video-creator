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

4. 9/22 대비 네트워크는 여전히 느림(업로드 ~77KB/s). 8.5KB 제품 이미지 업로드는 4초로 문제없었지만 1MB 세그먼트는 여전히 위험 → 워커 경로 E2E는 오늘도 시도 안 함.

## ⚠️ 지금 실제 코드 상태

- 워커/웹 모두 2단계 코드가 들어가 있고 워커는 재시작해서 새 코드로 4000 포트에 떠 있음. 웹 dev 서버(3000)는 핫리로드로 반영됨.
- **워커 코드 경로(파일 업로드 포함)로 실제 성공한 적은 1·2단계 모두 아직 없음.** 성공은 전부 CLI 우회(사전 업로드된 ID). 세그먼트 1(10–17초)과 병합 단계는 한 번도 실행 안 됨.
- 미커밋 변경: `worker/src/{server.js, pipeline/db.js, pipeline/jobRunner.js, pipeline/generate.js}`, `worker/test/{generate,server}.test.js`, `web/lib/workerApi.ts`, `web/components/Canvas.tsx`, `web/components/nodes/ProductInputNode.tsx`(신규), `web/test/workerApi.test.ts`, `docs/*`, 상위 폴더 `CLAUDE.md`(git 밖).

## 다음에 할 일 (우선순위 순)

1. **안정적인 네트워크에서 워커 E2E** — UI에서 Pexels 직링크 + `face_sample/ai-generated-woman-20260922.jpg` + `product_sample/eyeliner-…jpg`로 "실행" → 세그먼트 2개 생성 → 병합 → 결과 노드에서 다운로드까지 최초 확인 (약 120~140크레딧). 이게 되면 handoff 3번(UI 끝까지)과 2번(워커 경로)을 한 번에 해결.
2. 실패 시 `POST /jobs/:id/segments/:i/retry`로 세그먼트별 재시도 — 이제 retry도 제품 이미지를 같이 넘김.
3. (선택) 업로드 내성 — 워커가 `upload create`로 먼저 올려 ID를 받고 `generate create`는 ID로 호출하도록 분리하면 재시도 단위가 작아짐. 안정 네트워크에서 1번 먼저 확인한 뒤 판단.
4. (선택) 프롬프트 튜닝 — 지금 문구는 인물 "전체"를 바꿈(의상까지). 얼굴만 바꾸고 의상 유지가 필요하면 "Replace only the face…" 변형을 같은 소재로 비교(70크레딧).
5. 비용: 10초 세그먼트 70크레딧 고정(제품 교체 유무 무관). 17초 영상 1개 ≈ 120~140크레딧.

## 다음 세션 시작 시 프롬프트

```
docs/session-handoff-2026-09-23.md 읽고 정리된 순서대로 이어서 진행해줘.
```
