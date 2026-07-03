import type { Task, Status } from '../types'
import { ApiError } from '../api/client'

type Deps = {
  /** 서버 PATCH. 성공 시 서버가 확정한 최신 task 를 반환한다. */
  patchTask: (id: string, patch: Partial<Task> & { version: number }) => Promise<Task>
  /** 서버 POST. 성공 시 서버가 확정한 새 task(실제 id 포함)를 반환한다. */
  postTask: (input: Partial<Task>) => Promise<Task>
  /** 서버 DELETE. */
  removeTask: (id: string) => Promise<void>
  /** 캐시에서 현재 카드를 읽는다. */
  readTask: (id: string) => Task | undefined
  /** 캐시에 카드를 반영한다(upsert: 없으면 맨 앞에 삽입). */
  writeTask: (task: Task) => void
  /** 캐시에서 카드를 제거한다. */
  dropTask: (id: string) => void
  /**
   * 실패 확정(자동 재시도 소진 또는 409) 시 호출.
   * failedCount 는 재시도 대기 중인 실패 의도의 누적 건수 (retryFailed 로 전부 재시도).
   * 409 는 재시도 무의미라 큐에 들어가지 않는다.
   */
  onFailure: (message: string, failedCount: number) => void
  /** 자동 재시도 간 대기(ms). 배열 길이 = 자동 재시도 횟수. 테스트에서 주입. */
  retryDelays?: number[]
  /** 네트워크 연결 여부. 오프라인이면 요청을 보내지 않고 즉시 큐에 쌓는다. 기본: navigator.onLine */
  isOnline?: () => boolean
}

type CardState = {
  /** 마지막으로 확인된 서버 상태 — 실패 시 롤백 목적지이자 다음 요청의 version 출처 */
  baseline: Task
  /** 요청 진행 중에 새로 들어온 수정의 누적 patch (연타는 여기서 병합된다) */
  nextPatch: Partial<Task> | null
}

/** 실패 큐에 쌓이는 의도: retryFailed 가 이 정보만으로 재시도를 재현한다. */
type FailedEntry =
  | { kind: 'update'; id: string; patch: Partial<Task> }
  | { kind: 'create'; input: Partial<Task> }
  | { kind: 'remove'; id: string }

/** 일시 오류(500 등)는 조용히 흡수: 최초 1회 + 3회 자동 재시도 (실패율 15% 기준 잔존 ~0.05%) */
const DEFAULT_RETRY_DELAYS = [300, 600, 1200]

function isTempId(id: string) {
  return id.startsWith('temp-')
}

/** patch 의 모든 키가 local 과 같으면(no-op) true. */
function isNoop(local: Task, patch: Partial<Task>) {
  return (Object.keys(patch) as (keyof Task)[]).every((k) => local[k] === patch[k])
}

/**
 * 카드별 CRUD 직렬화 큐.
 * - 수정/생성/삭제는 캐시에 즉시(낙관적) 반영하고, 카드당 동시에 한 수정 요청만 보낸다.
 * - 진행 중에 온 수정은 nextPatch 로 병합되어 이전 응답의 version 으로 이어서 전송된다.
 * - 일시 오류는 백오프를 두고 자동 재시도하고, 소진하면 롤백/복원 후
 *   수동 재시도 액션과 함께 알린다. 409 는 재시도 없이 서버 최신 상태를 채택한다.
 * - 생성 중 임시 카드(id 가 temp- 로 시작)의 서버 id 는 아직 없으므로,
 *   그 카드에 대한 update/remove/move 는 무시한다.
 */
const OFFLINE_MESSAGE = '네트워크 연결을 확인해주세요.'

export function createTaskMover({
  patchTask,
  postTask,
  removeTask,
  readTask,
  writeTask,
  dropTask,
  onFailure,
  retryDelays = DEFAULT_RETRY_DELAYS,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
}: Deps) {
  const inFlight = new Map<string, CardState>()
  /** 낙관적으로 삭제된 카드 id. 삭제와 병렬로 진행 중이던 수정 응답이 카드를 되살리지 않도록 막는다. */
  const removed = new Set<string>()
  /** 자동 재시도까지 소진하고 실패한 의도. retryFailed 로 일괄 재시도 */
  const failed = new Map<string, FailedEntry>()

  function send(id: string, patch: Partial<Task>, attempt: number) {
    const state = inFlight.get(id)!
    patchTask(id, { ...patch, version: state.baseline.version })
      .then((server) => {
        state.baseline = server
        if (removed.has(id)) {
          // 응답이 오는 사이 카드가 삭제됐다: 되살리지 않는다
          inFlight.delete(id)
          return
        }
        if (state.nextPatch) {
          // 더 최신 patch 가 있다: 오래된 응답이 화면을 덮지 않도록
          // 낙관적 필드는 유지하고 서버 메타(version 등)만 채택
          writeTask({ ...server, ...state.nextPatch })
          const next = state.nextPatch
          state.nextPatch = null
          send(id, next, 0)
        } else {
          writeTask(server)
          inFlight.delete(id)
        }
      })
      .catch((err: unknown) => {
        const conflict =
          err instanceof ApiError && err.status === 409
            ? (err.payload as { current?: Task } | null)?.current
            : undefined
        if (conflict) {
          // 서버가 진실이다: 최신 상태 채택. 같은 version 재시도는 무의미.
          if (!removed.has(id)) writeTask(conflict)
          inFlight.delete(id)
          onFailure(err instanceof Error ? err.message : '충돌이 발생했습니다.', failed.size)
          return
        }
        if (attempt < retryDelays.length) {
          setTimeout(() => send(id, patch, attempt + 1), retryDelays[attempt])
          return
        }
        // 자동 재시도 소진: 마지막 서버 확정 상태로 롤백 + 실패 큐에 누적 (병합된 patch로)
        if (!removed.has(id)) writeTask(state.baseline)
        inFlight.delete(id)
        const finalPatch = state.nextPatch ? { ...patch, ...state.nextPatch } : patch
        failed.set(id, { kind: 'update', id, patch: finalPatch })
        onFailure(err instanceof Error ? err.message : '요청이 실패했습니다.', failed.size)
      })
  }

  /** 태스크 일부 필드를 낙관적으로 수정한다. move(id, status) 는 update(id, { status }) 의 특수형. */
  function update(id: string, patch: Partial<Task>) {
    if (isTempId(id)) return // 임시 카드는 서버 id 가 아직 없다
    const local = readTask(id)
    if (!local) return
    const state = inFlight.get(id)
    // no-op 가드는 큐 정리보다 먼저 — 같은 컬럼 드롭이 큐의 실패 의도를 지우면 안 된다
    if (!state && isNoop(local, patch)) return

    const prior = failed.get(id) // 오프라인 연속 수정 병합용
    failed.delete(id) // 수동 재수정은 옛 실패 의도를 대체한다

    if (!isOnline()) {
      // 선발행: 오프라인에선 시도가 무의미하므로 요청·낙관 반영 없이 즉시 알리고 큐에 보류
      const merged = prior?.kind === 'update' ? { ...prior.patch, ...patch } : patch
      failed.set(id, { kind: 'update', id, patch: merged })
      onFailure(OFFLINE_MESSAGE, failed.size)
      return
    }

    writeTask({ ...local, ...patch }) // 낙관적 반영
    if (state) {
      state.nextPatch = { ...state.nextPatch, ...patch } // 진행 중이면 patch 병합 (연타 합치기)
    } else {
      inFlight.set(id, { baseline: local, nextPatch: null })
      send(id, patch, 0)
    }
  }

  function move(id: string, to: Status) {
    update(id, { status: to })
  }

  /** 태스크를 낙관적으로 생성한다. */
  /** 생성 의도의 큐 키 — 내용 기반이라 같은 요청을 반복해도 한 건으로 병합된다. */
  const createKey = (input: Partial<Task>) => 'create:' + JSON.stringify(input)

  function create(input: Partial<Task>) {
    if (!isOnline()) {
      failed.set(createKey(input), { kind: 'create', input })
      onFailure(OFFLINE_MESSAGE, failed.size)
      return
    }
    const now = new Date().toISOString()
    const temp: Task = {
      id: 'temp-' + crypto.randomUUID(),
      version: 0,
      createdAt: now,
      updatedAt: now,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      title: input.title ?? '',
      ...input,
    }
    writeTask(temp) // 캐시 맨 앞에 즉시 삽입 (낙관적 반영)
    sendCreate(temp.id, input, 0)
  }

  function sendCreate(tempId: string, input: Partial<Task>, attempt: number) {
    postTask(input)
      .then((server) => {
        dropTask(tempId) // 임시 카드를 서버 카드로 교체
        writeTask(server)
      })
      .catch((err: unknown) => {
        if (attempt < retryDelays.length) {
          setTimeout(() => sendCreate(tempId, input, attempt + 1), retryDelays[attempt])
          return
        }
        dropTask(tempId)
        failed.set(createKey(input), { kind: 'create', input }) // 내용 키: 재생성 반복도 1건으로
        onFailure(err instanceof Error ? err.message : '생성이 실패했습니다.', failed.size)
      })
  }

  /**
   * 태스크를 낙관적으로 삭제한다.
   * ponytail: DELETE 는 version 을 쓰지 않아 409 여지가 없으므로, 진행 중인 수정과
   * 굳이 직렬화하지 않고 즉시 병렬로 요청을 보낸다(단순화). 삭제 후 도착하는 수정 응답이
   * 카드를 되살리지 않도록 removed 로 가드한다.
   */
  function remove(id: string) {
    if (isTempId(id)) return // 임시 카드는 서버 id 가 아직 없다
    const snapshot = readTask(id)
    if (!snapshot) return
    failed.delete(id)
    if (!isOnline()) {
      // 선발행: 삭제도 보류 — 카드는 화면에 유지하고 복구 시 재시도
      failed.set(id, { kind: 'remove', id })
      onFailure(OFFLINE_MESSAGE, failed.size)
      return
    }
    removed.add(id)
    dropTask(id) // 낙관적으로 즉시 제거
    sendRemove(id, snapshot, 0)
  }

  function sendRemove(id: string, snapshot: Task, attempt: number) {
    removeTask(id)
      .then(() => {
        removed.delete(id)
      })
      .catch((err: unknown) => {
        if (attempt < retryDelays.length) {
          setTimeout(() => sendRemove(id, snapshot, attempt + 1), retryDelays[attempt])
          return
        }
        removed.delete(id)
        writeTask(snapshot) // 복원
        failed.set(id, { kind: 'remove', id })
        onFailure(err instanceof Error ? err.message : '삭제가 실패했습니다.', failed.size)
      })
  }

  /** 실패 큐의 모든 의도(수정/생성/삭제)를 처음부터 다시 시도한다. */
  function retryFailed() {
    const entries = [...failed.values()]
    failed.clear()
    for (const entry of entries) {
      if (entry.kind === 'update') update(entry.id, entry.patch)
      else if (entry.kind === 'create') create(entry.input)
      else remove(entry.id)
    }
  }

  /** 실패 큐를 폐기한다(요청 취소). 화면은 실패 시점에 이미 롤백되어 있으므로 의도만 버린다. */
  function discardFailed() {
    failed.clear()
  }

  /** 실패한 의도의 종류와 대상 제목 — 알림에서 "무엇이 실패했는지" 보여주기 위한 요약. */
  function getFailed(): Array<{ kind: 'move' | 'update' | 'create' | 'remove'; label: string }> {
    return [...failed.values()].map((entry) => {
      if (entry.kind === 'create') return { kind: 'create', label: entry.input.title ?? '(제목 없음)' }
      const label = readTask(entry.id)?.title ?? '(삭제된 카드)'
      if (entry.kind === 'remove') return { kind: 'remove', label }
      // status 만 바꾸는 patch 는 이동, 그 외는 수정
      const keys = Object.keys(entry.patch)
      return { kind: keys.length === 1 && keys[0] === 'status' ? 'move' : 'update', label }
    })
  }

  return { move, update, create, remove, retryFailed, discardFailed, getFailed }
}
