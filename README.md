# Task Board — 채용 과제 스타터

**불안정한 서버(mock API) 위에서 견고하게 동작하는 칸반 태스크 보드**를 완성하는 과제입니다.
이 레포는 **시작점(baseline)** 입니다. 요구사항·평가 기준은 함께 전달된 **과제 명세서**를 확인하세요.

> 이 스타터는 일부러 "순진하게" 구현되어 있습니다. 드래그하면 화면만 바뀌고 서버에 저장되지 않으며,
> 5,000개를 그대로 렌더링합니다. 이걸 견고하고 빠르게 만드는 것이 과제입니다.

## 실행

```bash
npm install      # postinstall 에서 public/mockServiceWorker.js 자동 생성
npm run dev      # 개발 서버
npm test         # 유닛 테스트 (Vitest)
npm run build    # 타입체크 + 프로덕션 빌드
```

Node 18+ 권장.

## 이미 제공되는 것

| 구분 | 내용 |
|------|------|
| UI | 3컬럼 칸반 + 카드 렌더 + HTML5 드래그 앤 드롭(기본) |
| mock API | `src/mocks/` — 지연·실패·409 를 흉내내는 MSW 핸들러 |
| 시드 | 태스크 **5,000개** (결정적 생성, 모두 동일) |
| 세팅 | Vite + React 18 + TypeScript(strict) + Vitest |

## mock API 동작

모든 요청에 **200~800ms 랜덤 지연**이 있습니다.

| Method | Endpoint | 실패 |
|--------|----------|------|
| GET | `/api/tasks` | 드물게 500 |
| POST | `/api/tasks` | ~15% 500 |
| PATCH | `/api/tasks/:id` | ~15% 500, `version` 불일치 시 **409**(+서버 최신 상태) |
| DELETE | `/api/tasks/:id` | ~15% 500 |

- 실패율·지연은 **`src/mocks/config.ts`** 에서 조절합니다.
  개발 중 `WRITE_FAILURE_RATE = 1` 로 두면 모든 쓰기가 실패해 **롤백 동작을 확인**하기 좋습니다.
  (제출 전 기본값 복구)
- API 호출 함수는 **`src/api/client.ts`** 에 있습니다. 409 시 `ApiError.payload.current` 로 서버 최신 상태를 읽을 수 있습니다.

## 어디서부터?

`src/Board.tsx` 의 `TODO` 주석이 출발점입니다.

- [ ] 로딩/에러(재시도)/빈 상태
- [ ] 낙관적 업데이트 + 실패 롤백 (이동·수정·삭제·생성)
- [ ] 경쟁 상태 처리 (연속 이동)
- [ ] 5,000개에서의 성능 (검색/필터/드래그)
- [ ] 태스크 CRUD
- [ ] 핵심 로직 유닛 테스트 (`src/lib/tasks.test.ts` 참고)

`src/lib/`, `src/components/`, 상태 구조 등은 자유롭게 재구성해도 됩니다.

## GitHub Pages 배포

Vite `base` 를 저장소 이름으로 지정해 빌드하세요. service worker 등록 경로가 자동으로 따라갑니다.

```bash
VITE_BASE=/<저장소-이름>/ npm run build
```

배포 방법은 두 가지입니다.

- **GitHub Actions**: `deploy.yml.example` 을 `.github/workflows/deploy.yml` 로 옮기고 push
  → Settings → Pages → Source: **GitHub Actions**. (`main` push 시 자동 배포)
- **브랜치 배포**: 로컬 빌드 후 `dist` 를 `gh-pages` 브랜치로 push
  → Settings → Pages → Source: **Deploy from a branch → gh-pages**.

## 제출물

`README.md`(이 파일 갱신) · `DECISIONS.md` · `AI_USAGE.md` 를 포함하세요. 자세한 내용은 과제 명세서를 참고하세요.
