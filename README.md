# video_creator — 숏폼 리뷰 영상 제작 캔버스

원본 영상(사용 권한이 있는 것)의 인물·제품·의상/배경을 바꾸고 나레이션을 얹어 새 숏폼을 만드는 도구입니다.
**5초 미리보기로 먼저 확인하고, 승인한 설정으로만 나머지를 만들어** 생성 비용을 줄이는 것이 핵심입니다.

수업 실습용 저장소입니다. 클론해서 **자기 컴퓨터에서(로컬) 실행**하는 것을 전제로 합니다. 인터넷에 공개 서버로 띄우지 마세요(아래 "보안" 참고).

## 구성

```
video_creator/
├─ worker/   영상을 만드는 쪽 (Node.js + Express, :4000)
│            yt-dlp 다운로드 → ffmpeg 분할 → Higgsfield 생성 → 병합 → 편집 → 나레이션
├─ web/      화면 (Next.js + React Flow 캔버스, :3000)
│            로그인, 노드 캔버스, 미리보기·승인, 프롬프트 다듬기, 내 작업
└─ docs/     설계서, 구현 계획서, 개발 기록, Higgsfield 사용 기록
```

| 단계 | 하는 일 | 도구 / 모델 | 비용 (Higgsfield Plus 크레딧) |
|---|---|---|---|
| 다운로드·분할 | 영상 받기, 첫 구간 5초 + 10초 단위로 자르고 소리 제거 | yt-dlp, ffmpeg | 0 |
| 5초 미리보기 | 첫 5초만 인물(+제품) 교체 → 승인/거절 (최대 5회) | `ad_multiplier` | 약 35 / 회 |
| 나머지 구간 생성 | 승인한 설정으로 나머지 교체 | `ad_multiplier` | 초당 약 7 |
| 이어붙이기 | 구간 병합 | ffmpeg | 0 |
| 의상·배경 / 최종 보정 (선택) | 프롬프트로 다시 그리기 | `flux_3_video_edit` | 10초당 약 15 |
| 나레이션 (선택) | 대본 → 영어 음성 → 합성 | `text2speech_v2` | 약 0.45 |

## 준비물

- **Node.js 20 이상**
- **ffmpeg**, **yt-dlp** — macOS: `brew install ffmpeg yt-dlp`
- **Higgsfield CLI** (실제 생성할 때만) — `npm install -g @higgsfield/cli` 후 `higgsfield auth login`
  - 생성 비용은 **각자의 Higgsfield 계정 크레딧**에서 나갑니다(웹 요금제, 예: Plus).
  - 로그인 정보는 CLI가 `~/.config/higgsfield/`에 저장합니다. 이 저장소에는 들어오지 않습니다.

## 설치와 첫 실행 (테스트 모드 — 크레딧 0)

```bash
git clone <이 저장소 주소>
cd video_creator

# 1) 의존성 설치
(cd worker && npm install)
(cd web && npm install)

# 2) 웹 환경 파일 만들기 — 비밀값은 여기에만 둡니다 (git 제외)
cp web/.env.example web/.env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
#   ↑ 출력된 값을 web/.env.local 의 AUTH_SECRET= 뒤에 붙여 넣기

# 3) 로그인 계정 만들기 — web/data/users.json 에 저장됩니다 (git 제외)
(cd web && node scripts/add-user.mjs <아이디> "<표시 이름>" <비밀번호>)

# 4) 워커를 테스트 모드로 켜기 (터미널 1)
cd worker && npm run start:mock

# 5) 웹 켜기 (터미널 2)
cd web && npm run dev
```

브라우저에서 <http://localhost:3000> → 3)에서 만든 계정으로 로그인합니다.

**테스트 모드**에서는 크레딧을 쓰는 세 호출(인물 교체·편집·음성)만 무료 대역으로 바뀌고, 다운로드·분할·병합은 실제로 돕니다.
결과 영상은 원본 그대로 나오지만 흐름 전체와 "실제였다면 N크레딧" 비용 표시를 확인할 수 있습니다.

테스트용 소재 예: 영상 URL `https://videos.pexels.com/video-files/8143138/8143138-hd_1366_720_25fps.mp4`(Pexels 무료 라이선스),
인물은 **AI로 생성한 얼굴**, 제품은 로고 없는 사진을 권장합니다.

## 실제로 생성하기 (크레딧 사용)

```bash
higgsfield auth login            # 처음 한 번
higgsfield workspace list        # 잔액 확인
cd worker && npm start           # 실제 모드
```

- 테스트 모드에서 만든 작업은 실제 모드 워커에서 실행되지 않습니다(반대도 마찬가지).
- 실패한 생성은 Higgsfield가 자동 환불합니다. 중간에 실패하면 "이어서" 버튼으로 끝난 단계는 건너뜁니다.
- 30초 영상 기준: 미리보기 5회(최대) 175 + 나머지 25초 175 = **약 350크레딧**. 선택 단계를 모두 쓰면 약 440크레딧.

## 환경 변수

| 변수 | 어디 | 기본값 | 설명 |
|---|---|---|---|
| `AUTH_SECRET` | `web/.env.local` | (개발 중에만 고정 공개 값) | 로그인 쿠키 서명. **반드시 직접 생성한 값으로** |
| `WORKER_URL` | `web/.env.local` | `http://localhost:4000` | 웹 서버가 중계할 워커 주소 |
| `ANTHROPIC_API_KEY` | `web/.env.local` | 없음 | 있으면 "프롬프트 다듬기"를 Claude가 함. 없으면 내장 템플릿 |
| `GENERATOR` | 워커 실행 시 | `higgsfield` | `mock`이면 테스트 모드 (`npm run start:mock`) |
| `PORT` | 워커 실행 시 | `4000` | 워커 포트 |
| `CREDIT_KRW` | 워커 실행 시 | `60` | 크레딧당 원화 (비용 표시용) |

## 보안 — 꼭 지킬 것

- **비밀값은 커밋하지 않습니다.** `web/.env.local`, `web/data/`(계정), `worker/data/`(업로드·결과 영상·작업 기록)는 `.gitignore`로 제외되어 있습니다.
  `git add -A` 전에 `git status`로 이 파일들이 없는지 확인하세요.
- **워커에는 인증이 없습니다.** 브라우저는 로그인한 웹 서버를 거쳐서만 워커를 부르지만, 워커 포트(4000)를 외부에 열면
  누구나 내 Higgsfield 크레딧으로 생성할 수 있습니다. 로컬에서만 실행하세요.
- 로그인은 **시연용**입니다(로컬 데모 계정). 여러 사람에게 서비스하는 용도로 만들지 않았습니다.
- **사용 권한이 있는 영상만** 쓰세요(본인 촬영, 라이선스·허가받은 영상). 실존 인물 사진 대신 AI 생성 얼굴을 권장합니다.
- "내 Higgsfield 연결" 창은 **준비 중 화면**입니다. 입력한 키는 저장하거나 전송하지 않습니다.

## 테스트

```bash
(cd worker && npm test)                       # node --test
(cd web && npx vitest run && npx tsc --noEmit)
```

테스트는 Higgsfield·ffmpeg를 실제로 부르지 않습니다(크레딧 0).

## 문서

- `docs/superpowers/specs/` — 설계서
- `docs/superpowers/plans/` — 구현 계획서 (5초 미리보기 흐름, 시연용 로그인 등)
- `docs/higgsfield-cli-notes.md` — 모델별 실사용 기록과 비용
- `docs/session-handoff-*.md` — 날짜별 개발 기록
