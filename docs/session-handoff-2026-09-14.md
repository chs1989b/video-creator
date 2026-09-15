# 작업 이어가기 — 2026-09-14 세션 정리

## 오늘까지 완료된 것

1. **기획/설계 완료**: Arcads.ai를 벤치마킹해서 "유튜브 영상 속 인물을 AI 캐릭터로 교체하는 개인용 영상 제작 도구"를 기획함
   → 설계 문서: `docs/superpowers/specs/2026-09-14-video-creator-design.md`
2. **git 저장소 문제 발견 및 조치 방법 정리**: 홈 디렉토리 전체가 하나의 git 저장소로 잡혀 있는 문제를 발견함
   → 조치 가이드: `docs/git-repo-issue.md`

## 다음에 이어서 할 일 (순서대로)

### 1단계 — git 저장소 정리 (먼저 처리 권장)

`docs/git-repo-issue.md` 문서를 열어서 순서대로 진행. 지금 실제 코드를 만들기 시작하면 파일 수가 늘어나면서 홈 디렉토리 저장소 문제가 더 꼬이기 쉬우므로, **코드 작성을 시작하기 전에** 이 문제부터 정리하는 걸 추천함.

핵심 흐름: 홈 디렉토리 `.git` 백업/제거 → `video_creator` 폴더 안에 새 git 저장소 생성 → 스펙 문서 2개(`2026-09-14-video-creator-design.md`, `git-repo-issue.md`) 새 저장소로 커밋 → git 사용자 정보(`user.name`/`user.email`) 실제 값으로 수정

### 2단계 — 구현 계획 수립 (`writing-plans` 스킬)

git 정리가 끝났으면, 새 Claude 세션에서 아래처럼 요청해서 이어가면 됨:

> "`docs/superpowers/specs/2026-09-14-video-creator-design.md` 스펙 문서를 기반으로 writing-plans 스킬을 써서 구현 계획을 짜줘."

이 단계에서 나올 결과물: 실제로 어떤 순서로 무엇을 만들지(예: yt-dlp 연동 → Higgsfield CLI 연동 검증 → 세그먼트 분할/병합 로직 → 워커 API → 웹 UI 순서 등), 파일/폴더 구조, 각 단계별 테스트 방법이 담긴 구체적인 구현 계획 문서.

### 3단계 — 구현 착수 전 최우선 검증 항목 (스펙 문서 §8)

계획을 짜기 전이든 직후든, 아래 항목은 실제 코드를 많이 쓰기 전에 반드시 먼저 확인해야 함 (스펙 문서에도 명시돼 있음):

> **Higgsfield CLI(`@higgsfield/cli`)가 Genjutsu 기능을 실제로 지원하는지, 무료 멤버십 한도 내에서 동작하는지** — 직접 로그인해서 CLI로 Genjutsu 호출이 되는지 테스트해볼 것. 안 되면 스펙 문서에 적어둔 대로 Playwright 브라우저 자동화로 폴백해야 하므로, 이 결과에 따라 구현 계획의 워커 연동 방식이 달라질 수 있음.

## 다음 세션 시작 시 참고할 파일 목록

- `docs/superpowers/specs/2026-09-14-video-creator-design.md` — 전체 설계 (프로그램 개요, 아키텍처, 파이프라인, 리스크)
- `docs/git-repo-issue.md` — git 저장소 문제 조치 가이드
- `docs/session-handoff-2026-09-14.md` — 이 문서 (다음 할 일 요약)
