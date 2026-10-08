# 시연용 로그인 + Higgsfield API 연결 UI 계획

**목표:** 로컬 시연에서 로그인 → 내 작업만 보기 → 지난 작업 불러오기를 실제로 동작시키고,
"사용자가 자기 Higgsfield API를 연결하는 서비스"를 **준비 중 화면**으로 보여 준다.

**결정 (2026-10-08, 프로젝트 CLAUDE.md):** 외부 배포는 하지 않는다. 로그인은 실제 동작, API 키 UI는 동작하지 않으며
키를 저장·전송하지 않는다. 실제 연결(BYOK)은 4회차의 과금 단위 결정 이후.

**브랜치:** `demo-login` (`mock-generator` 위). 커밋은 사용자가 요청할 때만.

## 구조

```
브라우저 ──(쿠키 세션)──▶ Next.js 웹 :3000
                           ├─ middleware.ts        세션 없으면 /login (API는 401)
                           ├─ /api/auth/login|logout|me
                           ├─ /api/worker/[...path] 워커 중계 — x-owner-id 헤더를 붙여 전달
                           └─ /api/prompt/refine    (기존)
                                   │
                                   ▼
                           워커 :4000 — x-owner-id가 있으면 그 사용자의 작업만 보이고 다룰 수 있음
```

- 브라우저는 더 이상 워커를 직접 부르지 않는다(`workerApi` 기본 주소 = `/api/worker`).
- 워커는 헤더가 없으면 지금과 똑같이 동작한다(기존 테스트·CLI 호출 호환).
  워커 자체에는 인증이 없으므로 **외부 배포 시에는 부족하다** — 이번 범위는 로컬 시연.

## 할 일

| # | 내용 | 테스트 |
|---|---|---|
| 1 | 워커: 작업에 `ownerId` 저장, `GET /jobs` 소유자 필터, `/jobs/:id…` 전체에 소유자 검사(`app.param`), 끝난 시각 `finishedAt` | `node --test` |
| 2 | 웹 `lib/auth.ts`: PBKDF2 비밀번호 해시·검증, HMAC 서명 세션(만료 포함) — Web Crypto라 미들웨어에서도 동작 | vitest |
| 3 | 웹 `lib/users.ts` + `scripts/add-user.mjs`: `web/data/users.json`(git 제외)에 데모 계정 | vitest |
| 4 | 로그인 API·미들웨어·로그인 화면, 상단 사용자 이름·로그아웃 | vitest(순수 함수) + 브라우저 |
| 5 | 워커 중계 라우트(업로드·영상 Range 요청 포함), `workerApi` 기본 주소 변경, `listJobs` | vitest + 브라우저 |
| 6 | 작업 히스토리 패널(우하단): 시작·완료 시각, 상태, 비용, 불러오기 | vitest(순수 함수) + 브라우저 |
| 7 | "내 Higgsfield 연결" 창: 준비 중 배지, 키 ID·시크릿 입력(저장 안 함), CLI vs API 설명, 연결 후 예시 화면 | 브라우저 |
| 8 | 테스트 모드 종단 실행 1회(크레딧 0), CLAUDE.md 갱신 | — |

## 지킬 것

- 새 npm 의존성 없음(Next.js·Web Crypto·node:crypto만).
- API 키 입력값은 컴포넌트 상태에만 두고 창을 닫으면 지운다. localStorage·서버 전송 금지.
- `AUTH_SECRET`은 `web/.env.local`. 없으면 개발 중에만 임시 값을 쓰고 경고(재시작하면 다시 로그인).
- 옛 작업(`ownerId` 없음)은 로그인 사용자에게 보이지 않는다(중계를 거치면 소유자 일치가 필요).
- 금액·크레딧 기능은 그대로. 실제 크레딧은 쓰지 않는다.
