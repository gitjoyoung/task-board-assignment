# 엔터프라이즈 사례 연구 — 이 과제와 같은 문제를 그들은 어떻게 풀었나

이 문서는 본 과제의 핵심 문제(낙관적 업데이트·롤백·경쟁 상태·충돌·재시도·대량 렌더)를
실제 프로덕션에서 해결한 기업들의 공개 기술 문서를 조사하고, 우리 구현과 대조한 기록이다.
각 절은 "사례 → 우리 구현과의 매핑 → 차이점" 순서로 구성했다.

---

## 1. 낙관적 업데이트와 로컬 우선 아키텍처 — Trello, Linear

**Trello (Atlassian)** 는 변경을 클라이언트에 낙관적으로 먼저 적용하고, 서버에서 실패하면
롤백하는 구조를 사용한다. 다른 사용자의 변경은 WebSocket으로 수신하며, 서버가 진실의
원천(source of truth)이다. 업로드 실패 시 이후의 서버 GET이 로컬 변경을 덮어쓰도록 두되,
데이터 유실을 줄이기 위해 "다운로드보다 업로드를 먼저" 처리한다.

**Linear** 는 여기서 한 발 더 나가 로컬 우선(local-first)이다. 모든 뮤테이션이 로컬
인메모리 상태에 동기적으로 적용되어 UI가 즉시 리렌더되고, IndexedDB에 영속화된 트랜잭션
큐가 백그라운드에서 서버로 순서를 보장하며 배치 전송한다. 오프라인 동안의 변경도 같은
큐에 쌓였다가 재연결 시 flush된다. 공동창업자는 "동기화 엔진을 가장 먼저 만들어야 나머지가
제대로 느껴진다"는 원칙으로 첫 코드를 sync engine으로 시작했다.

**우리 구현과의 매핑** (`src/lib/taskMover.ts`)
- 낙관적 즉시 반영 + 실패 시 롤백: Trello와 동일한 기본 패턴
- 카드별 직렬화 큐(카드당 동시 요청 1개, 순서 보장): Linear의 트랜잭션 큐를 카드 단위로 축소한 형태
- 서버가 진실: 롤백 목적지가 항상 `baseline`(마지막 서버 확정 상태)

**차이점**: Linear는 큐를 IndexedDB에 영속화해 탭을 닫아도 전송이 보장되지만, 우리는
메모리 큐다(탭을 닫으면 미전송 변경 유실). 과제 범위에서 오프라인 영속화는 P2 밖이라
의도적으로 생략했다.

출처:
- [Sync failure handling — Atlassian Engineering](https://www.atlassian.com/blog/atlassian-engineering/sync-failure-handling)
- [How's Linear so fast? A technical breakdown — performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)
- [Linear's sync engine architecture — fujimon.com](https://www.fujimon.com/blog/linear-sync-engine)
- [Optimistic Updates — TanStack Query 공식 문서](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) (onMutate 스냅샷 → onError 롤백 패턴의 정형화)

---

## 2. 오래된 응답이 최신 상태를 덮는 문제("깜빡임") — Figma

**Figma** 는 반응성을 위해 로컬 변경을 서버 확인 없이 즉시 적용하는데, 이때 서버에서
들어오는 변경을 그대로 다 적용하면 "아직 확인(ack)되지 않은 내 최신 변경"을 오래된 값이
잠시 덮어쓰는 깜빡임(flicker)이 생긴다. Figma의 해법: **미확인 로컬 변경과 충돌하는 서버
수신 변경은 버린다.** 내 최신 변경이 곧 서버 순서상 가장 최근 편집이므로, 최종 일관 상태에
대한 최선의 예측이라는 논리다.

**우리 구현과의 매핑** (`src/lib/taskMover.ts` 의 `nextPatch` 처리)
- 같은 카드를 연속 이동할 때, 첫 요청의 응답이 늦게 도착해도 화면의 status는 최신 낙관적
  값을 유지하고 서버 메타(version 등)만 채택한다 — Figma의 "미확인 변경 우선"과 동일한 원리
- 테스트: "늦게 도착한 이전 응답이 최신 낙관적 상태를 덮어쓰지 않는다" (`taskMover.test.ts`)

**차이점**: Figma는 실시간 멀티플레이어라 서버 푸시 변경까지 이 규칙을 적용하지만,
우리는 단일 클라이언트의 자기 응답에만 적용하면 충분하다.

출처:
- [How Figma's multiplayer technology works — Figma Blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

---

## 3. 충돌 해결 — Figma의 property-level LWW, Trello의 실용주의

**Figma** 는 OT(Operational Transform)를 "우리 문제에 불필요하게 복잡"하다고 기각하고,
CRDT에서 영감을 받되 서버가 순서를 정의하는 단순화를 택했다. 충돌 단위는 "객체의 속성"이며,
같은 객체의 같은 속성을 동시에 바꿀 때만 마지막 쓰기가 이긴다(last-writer-wins).
서버가 이벤트 순서를 정하므로 타임스탬프도 필요 없다.

**Trello** 도 동시 편집 충돌이 실사용에서 드물다는 관측에 근거해 대부분의 데이터에
last-writer-wins를 적용했고, 설명(description) 같은 장문 필드만 분석 지표로 감시하다가
필요해지면 정교한 해법을 도입하기로 했다.

**우리 구현과의 매핑**
- mock 서버의 `version` 기반 낙관적 동시성 제어(409)는 LWW보다 보수적인 "first-writer-wins +
  명시적 충돌 통보"다. 우리는 409 수신 시 **서버 최신 상태를 채택하고 사용자에게 알린다**
  (`taskMover.ts` 의 conflict 처리) — 내 변경을 최신 version으로 강제 재전송하는 대안은
  상대방의 변경을 말없이 덮어쓰므로 기각했다.
- 자기 자신과의 충돌은 카드별 직렬화(다음 요청이 직전 응답의 version 사용)로 원천 차단했다.
  남는 409 경로는 다른 탭(=다른 사용자)뿐이다.

**차이점**: Figma/Trello의 LWW는 "충돌을 조용히 해소"하는 쪽이고, 우리(과제 명세)는
"충돌을 표면화"하는 쪽이다. 협업 도구에서 조용한 LWW가 통하는 건 충돌 빈도가 낮고 실시간
피드백(상대 커서가 보임)이 있기 때문 — 그 전제가 없는 우리 환경에선 통보가 더 정직하다.

출처:
- [How Figma's multiplayer technology works — Figma Blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Sync failure handling — Atlassian Engineering](https://www.atlassian.com/blog/atlassian-engineering/sync-failure-handling)

---

## 4. 재시도 전략 — Trello의 오류 분류, AWS의 백오프+지터, Stripe의 멱등성

**Trello** 는 실패를 HTTP 상태코드로 **일시적(temporary) vs 영구적(permanent)** 으로 분류한다.
일시적 오류만 지수 백오프로 재시도하되 횟수 상한을 두고, 영구적 오류는 해당 변경(delta)을
버리고 진행한다.

**AWS (Marc Brooker)** 는 순수 지수 백오프의 함정을 시뮬레이션으로 보였다: 모든 클라이언트가
같은 간격으로 재시도하면 호출이 뭉쳐서(retry storm) N개 클라이언트가 약 N²의 일을 만든다.
해법은 백오프에 무작위성(jitter)을 더하는 것이며, 변형 중 **Full Jitter**(0 ~ 백오프 상한
사이 균등 난수)가 총 작업량 기준 최선이었다.

**Stripe** 는 안전한 재시도의 전제로 **멱등성 키**를 설계했다. 클라이언트가 요청마다 고유
ID를 생성해 보내면, 서버는 중복 키 요청을 무시하고 첫 응답을 캐시에서 돌려준다 — "응답을
못 받았는데 서버는 처리한" 모호한 실패에서도 재시도가 안전해진다. Trello도 같은 목적으로
클라이언트 생성 UUID를 쓴다.

**우리 구현과의 매핑** (`src/lib/taskMover.ts`)
- 오류 분류: 409(영구적 — 재시도 무의미)는 즉시 서버 상태 채택, 500(일시적)만 자동 재시도
  — Trello의 분류와 같은 구조
- 백오프: 0.3초 백오프, 자동 1회 상한 — Trello의 "상한 있는 지수 백오프"와 같은 구조
  (처음 3회였다가 실패 인지가 ~4.5초로 늦어져 1회로 축소, PD-3)
- 소진 후: 롤백 + 실패 큐 누적 + 수동 일괄 재시도 버튼 (자동/수동 하이브리드)

**의도적 차이점 (알고 있는 한계)**
- **지터 없음**: AWS의 지터는 수천 클라이언트가 동시에 재시도하는 서버 보호 장치다.
  우리는 단일 사용자 클라이언트고 mock 서버라 재시도 폭풍이 성립하지 않아 생략했다.
  실서비스로 간다면 Full Jitter 추가가 표준이다.
- **멱등성 키 없음**: mock API가 Idempotency-Key를 지원하지 않는다. 이 mock의 실패(500)는
  "서버가 적용 전에 거부"로 정의되어 있어(handlers의 실패 판정이 상태 변경보다 앞) 재시도가
  중복을 만들지 않지만, 실서버라면 POST 재시도에 Stripe식 멱등성 키가 필수다.
  DELETE는 자연 멱등이고, PATCH는 version이 약한 중복 가드 역할을 한다.

출처:
- [Sync failure handling — Atlassian Engineering](https://www.atlassian.com/blog/atlassian-engineering/sync-failure-handling)
- [Exponential Backoff And Jitter — AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Timeouts, retries, and backoff with jitter — Amazon Builders' Library](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [Designing robust and predictable APIs with idempotency — Stripe Blog](https://stripe.com/blog/idempotency)

---

## 5. 대량 리스트 렌더링 — Jira의 가상화 사례

**Jira (Atlassian)** 는 백로그/보드가 모든 이슈를 뷰포트 밖까지 전부 렌더해서 이슈 수에
비례해 렌더 시간이 늘어나는 문제를 겪었다. 해법은 React 가상화 라이브러리(react-virtualized)로
**보이는 이슈 + 뷰포트 밖 버퍼 10개**만 렌더하는 것. 측정 결과: 백로그 열기 51% 개선,
보드 열기 35%, 필터링 TTI 50%, 200개 이상 보드의 이슈 마운트 시간 약 80% 감소.

Atlassian의 드래그 앤 드롭 가이드는 가상화와 DnD를 함께 쓸 때의 함정도 문서화했다:
드래그 중 원본 요소가 가상화로 언마운트될 수 있으므로, 이벤트는 사라지지 않는 상위
엔티티에서 수신해야 한다.

**우리 구현과의 매핑** (`src/components/Column.tsx`)
- @tanstack/react-virtual, **overscan 10** — Jira의 버퍼 10개와 동일한 값
- 결과: DOM 카드 5,000 → ~54개, 연속 스크롤 프레임 평균 4.1ms (60fps 예산의 1/4)
- 드롭 이벤트를 카드가 아닌 컬럼(`<section>`)에서 수신 — Atlassian이 경고한
  "드래그 중 언마운트" 함정을 구조적으로 회피

**차이점**: Jira는 이슈 높이가 가변이라 실측 기반이지만, 우리는 제목 한 줄 말줄임으로
높이를 75px 고정해 실측(ResizeObserver) 없이 더 단순하게 갔다.

출처:
- [Performance for Jira's team-managed projects just got snappier! — Atlassian Community](https://community.atlassian.com/t5/Team-managed-projects-articles/Performance-for-Jira-s-team-managed-projects-just-got-snappier/ba-p/1812056)
- [Virtualization — Pragmatic drag and drop, Atlassian Design System](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/improving-performance/virtualization/)

---

## 6. 오프라인/재연결 — Figma의 단순화 (참고)

Figma는 재연결 시 (1) 서버에서 문서 사본을 새로 받고 (2) 오프라인 편집을 그 위에 재적용하고
(3) WebSocket 동기화를 재개한다. 재연결 자체를 단순하게 유지하고 복잡성을 "연결된 상태의
업데이트"에 집중시키는 설계다. 우리의 "네트워크 단절 시 동작" 결정(DECISIONS.md 5번)에서
참고할 만한 패턴: 복잡한 오프라인 병합 대신, 재연결 시 서버 기준 재조회 + 실패 큐 재시도.

출처:
- [How Figma's multiplayer technology works — Figma Blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

---

## 종합: 수렴하는 패턴

조사한 모든 사례가 독립적으로 같은 결론에 도달했다:

1. **로컬에 먼저 쓰고 화면은 로컬만 본다** (Trello/Linear/Figma 공통)
2. **서버가 진실이고, 실패 시 서버 상태로 돌아간다** (Trello의 GET-덮어쓰기, 우리의 baseline 롤백)
3. **미확인 로컬 변경 > 늦게 온 서버 응답** (Figma flicker 방지, 우리의 nextPatch 유지)
4. **충돌 해법은 도메인의 실제 충돌 빈도에 맞춘다** — 이론적 완전성(OT/CRDT)보다 단순한 LWW나
   version 통보로 충분한 경우가 대부분 (Figma/Trello)
5. **재시도는 분류(일시/영구) → 상한 있는 백오프(+지터) → 멱등성 보장** 순으로 설계한다
   (Trello/AWS/Stripe)
6. **가상화는 "보이는 것 + 버퍼 10"이 업계 공통 값** (Jira, 우리 overscan 10)

우리 구현은 이 패턴들의 단일 클라이언트 축소판이며, 의도적으로 생략한 것(큐 영속화, 지터,
멱등성 키)은 각 절의 "차이점"에 근거와 함께 기록했다.

---

*조사 방법: 각 기업의 1차 기술 블로그/공식 문서를 직접 확인했고, 1차 출처가 없는 경우
(Linear) 기술 분석 글을 교차 참조했다. 조사일: 2026-07-03.*
