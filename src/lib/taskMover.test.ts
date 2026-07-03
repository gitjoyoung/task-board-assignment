import { describe, it, expect, vi } from 'vitest'
import type { Task } from '../types'
import { ApiError } from '../api/client'
import { createTaskMover } from './taskMover'

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '테스트 태스크',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

type Deferred = {
  promise: Promise<Task>
  resolve: (t: Task) => void
  reject: (e: unknown) => void
}

function deferred(): Deferred {
  let resolve!: (t: Task) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<Task>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 마이크로태스크 큐를 비운다 (mover 내부 .then 체인 실행 대기) */
const flush = () => new Promise((r) => setTimeout(r, 0))

type VoidDeferred = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void }

function voidDeferred(): VoidDeferred {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(
  initial: Task = makeTask(),
  retryDelays: number[] = [],
  extra: {
    onCommitted?: (t: Task) => void
    onRemoved?: (id: string) => void
    onIntentSettled?: (key: string, ok: boolean) => void
  } = {},
) {
  // 순서 보존이 필요(생성 카드가 "맨 앞"인지 검증)하므로 Map 을 매번 재구성해 upsert 한다.
  // (테스트가 destructure 한 cache 참조가 계속 유효하도록 재할당 대신 같은 Map 을 clear+재삽입한다)
  const cache = new Map<string, Task>([[initial.id, initial]])
  const calls: Array<{ id: string; patch: Partial<Task> & { version: number }; d: Deferred }> = []
  const patchTask = vi.fn((id: string, patch: Partial<Task> & { version: number }) => {
    const d = deferred()
    calls.push({ id, patch, d })
    return d.promise
  })
  const postCalls: Array<{ input: Partial<Task>; d: Deferred }> = []
  const postTask = vi.fn((input: Partial<Task>) => {
    const d = deferred()
    postCalls.push({ input, d })
    return d.promise
  })
  const removeCalls: Array<{ id: string; d: VoidDeferred }> = []
  const removeTask = vi.fn((id: string) => {
    const d = voidDeferred()
    removeCalls.push({ id, d })
    return d.promise
  })
  const onFailure = vi.fn()
  const mover = createTaskMover({
    patchTask,
    postTask,
    removeTask,
    readTask: (id) => cache.get(id),
    writeTask: (t) => {
      if (cache.has(t.id)) {
        cache.set(t.id, t)
        return
      }
      // upsert: 없으면 맨 앞에 삽입. Map 은 삽입 순서를 보존하므로
      // clear 후 새 항목을 먼저 넣고 기존 항목을 이어 붙인다 (참조는 그대로 유지).
      const rest = [...cache.entries()]
      cache.clear()
      cache.set(t.id, t)
      for (const [k, v] of rest) cache.set(k, v)
    },
    dropTask: (id) => cache.delete(id),
    onFailure,
    retryDelays,
    ...extra,
  })
  return {
    cache,
    calls,
    postCalls,
    removeCalls,
    patchTask,
    postTask,
    removeTask,
    onFailure,
    mover,
  }
}

describe('createTaskMover — 낙관적 이동', () => {
  it('이동은 서버 응답 전에 즉시 캐시에 반영된다', () => {
    const { cache, mover, patchTask } = setup()
    mover.move('t1', 'done')
    expect(cache.get('t1')!.status).toBe('done')
    expect(patchTask).toHaveBeenCalledWith('t1', { status: 'done', version: 1 })
  })

  it('성공하면 서버 응답(version 증가)으로 카드를 갱신한다', async () => {
    const { cache, calls, mover } = setup()
    mover.move('t1', 'done')
    calls[0].d.resolve(makeTask({ status: 'done', version: 2 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'done', version: 2 })
  })

  it('실패하면 해당 카드만 이동 전 상태로 롤백하고 사용자에게 알린다', async () => {
    const { cache, calls, mover, onFailure } = setup()
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'todo', version: 1 })
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})

describe('createTaskMover — 경쟁 상태', () => {
  it('연속 이동은 직렬화된다: 동시에 한 요청만, 다음 요청은 이전 응답의 version을 쓴다', async () => {
    const { cache, calls, mover, patchTask } = setup()
    mover.move('t1', 'done')
    mover.move('t1', 'in-progress')
    expect(patchTask).toHaveBeenCalledTimes(1) // 두 번째는 대기

    calls[0].d.resolve(makeTask({ status: 'done', version: 2 }))
    await flush()
    expect(patchTask).toHaveBeenCalledTimes(2)
    expect(calls[1].patch).toEqual({ status: 'in-progress', version: 2 })

    calls[1].d.resolve(makeTask({ status: 'in-progress', version: 3 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'in-progress', version: 3 })
  })

  it('늦게 도착한 이전 응답이 최신 낙관적 상태를 덮어쓰지 않는다 (version만 채택)', async () => {
    const { cache, calls, mover } = setup()
    mover.move('t1', 'done')
    mover.move('t1', 'in-progress') // 화면은 in-progress

    calls[0].d.resolve(makeTask({ status: 'done', version: 2 })) // 첫 이동의 응답 도착
    await flush()
    // status 는 낙관적 상태 유지, version 은 서버 값 채택
    expect(cache.get('t1')).toMatchObject({ status: 'in-progress', version: 2 })
  })

  it('빠른 연타는 마지막 목표로 합쳐진다: 중간 상태는 서버에 보내지 않는다', async () => {
    const { calls, mover, patchTask } = setup()
    mover.move('t1', 'in-progress')
    mover.move('t1', 'done')
    mover.move('t1', 'todo') // 최종 목표만 유효

    calls[0].d.resolve(makeTask({ status: 'in-progress', version: 2 }))
    await flush()
    expect(patchTask).toHaveBeenCalledTimes(2) // done 은 건너뛰고 todo 만
    expect(calls[1].patch).toEqual({ status: 'todo', version: 2 })
  })

  it('체인 중간 실패 시 마지막으로 확인된 서버 상태로 롤백한다', async () => {
    const { cache, calls, mover, onFailure } = setup()
    mover.move('t1', 'in-progress')
    mover.move('t1', 'done')

    calls[0].d.resolve(makeTask({ status: 'in-progress', version: 2 })) // 첫 이동 성공
    await flush()
    calls[1].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null)) // 두 번째 실패
    await flush()

    // 처음(todo/v1)이 아니라 첫 이동이 확정된 상태(in-progress/v2)로 롤백
    expect(cache.get('t1')).toMatchObject({ status: 'in-progress', version: 2 })
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})

describe('createTaskMover — 자동 재시도', () => {
  it('일시 오류는 자동 재시도로 흡수된다: 재시도가 성공하면 롤백도 알림도 없다', async () => {
    const { cache, calls, mover, patchTask, onFailure } = setup(makeTask(), [0, 0, 0])
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()
    await flush() // 백오프 타이머(0ms)로 예약된 재시도 실행 대기

    expect(patchTask).toHaveBeenCalledTimes(2) // 자동 재시도 발사
    calls[1].d.resolve(makeTask({ status: 'done', version: 2 }))
    await flush()

    expect(cache.get('t1')).toMatchObject({ status: 'done', version: 2 })
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('자동 재시도를 모두 소진하면 롤백하고, 실패 건수와 함께 알린다', async () => {
    const { cache, calls, mover, patchTask, onFailure } = setup(makeTask(), [0, 0, 0])
    mover.move('t1', 'done')
    for (let i = 0; i < 4; i++) {
      calls[i].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
      await flush()
      await flush() // 백오프 타이머(0ms)로 예약된 재시도 실행 대기
    }

    expect(patchTask).toHaveBeenCalledTimes(4) // 최초 1 + 자동 재시도 3
    expect(cache.get('t1')).toMatchObject({ status: 'todo', version: 1 }) // 롤백
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][1]).toBe(1) // 실패 큐에 1건
  })

  it('여러 카드가 실패하면 전부 누적되고, retryFailed 는 전부 다시 시도한다', async () => {
    const t1 = makeTask({ id: 't1', status: 'todo' })
    const t2 = makeTask({ id: 't2', status: 'todo' })
    const { cache, calls, mover, patchTask, onFailure } = setup(t1, [])
    cache.set('t2', t2)

    mover.move('t1', 'done')
    mover.move('t2', 'in-progress')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    calls[1].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()

    expect(onFailure).toHaveBeenCalledTimes(2)
    expect(onFailure.mock.calls[1][1]).toBe(2) // 실패 큐에 2건 누적

    mover.retryFailed() // 전부 다시 시도
    expect(patchTask).toHaveBeenCalledTimes(4)
    expect(cache.get('t1')!.status).toBe('done') // 다시 낙관적 반영
    expect(cache.get('t2')!.status).toBe('in-progress')

    calls[2].d.resolve(makeTask({ id: 't1', status: 'done', version: 2 }))
    calls[3].d.resolve(makeTask({ id: 't2', status: 'in-progress', version: 2 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'done', version: 2 })
    expect(cache.get('t2')).toMatchObject({ status: 'in-progress', version: 2 })
  })

  it('실패한 카드를 손으로 다시 이동하면 실패 큐에서 빠진다 (옛 의도를 재생하지 않음)', async () => {
    const { calls, mover, patchTask } = setup(makeTask(), [])
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()

    mover.move('t1', 'in-progress') // 수동 재이동
    expect(patchTask).toHaveBeenCalledTimes(2)

    mover.retryFailed() // 큐는 비어 있어야 함
    expect(patchTask).toHaveBeenCalledTimes(2) // 추가 요청 없음
  })

  it('getFailed 는 실패한 의도의 종류·대상·상세(어디서 어디로, 어떤 필드)를 알려준다', async () => {
    const t1 = makeTask({ id: 't1', title: '이동할 카드', status: 'todo' })
    const { cache, calls, mover, postCalls, removeCalls } = setup(t1, [])
    cache.set('t2', makeTask({ id: 't2', title: '수정할 카드', status: 'in-progress' }))
    cache.set('t3', makeTask({ id: 't3', title: '삭제할 카드', status: 'done' }))

    mover.move('t1', 'done')
    mover.update('t2', { title: '바뀐 제목', description: '설명도' })
    mover.create({ title: '생성할 카드', status: 'in-progress' })
    mover.remove('t3')
    calls[0].d.reject(new ApiError(500, '오류', null))
    calls[1].d.reject(new ApiError(500, '오류', null))
    postCalls[0].d.reject(new ApiError(500, '오류', null))
    removeCalls[0].d.reject(new ApiError(500, '오류', null))
    await flush()

    expect(mover.getFailed()).toEqual([
      { key: 't1', kind: 'move', label: '이동할 카드', from: 'todo', to: 'done' }, // 롤백된 위치 → 목표
      { key: 't2', kind: 'update', label: '수정할 카드', fields: ['title', 'description'] },
      {
        key: 'create:{"title":"생성할 카드","status":"in-progress"}',
        kind: 'create',
        label: '생성할 카드',
        status: 'in-progress',
      },
      { key: 't3', kind: 'remove', label: '삭제할 카드', status: 'done' }, // 복원된 카드의 위치
    ])
  })

  it('discardFailed 는 실패 큐를 폐기한다: 이후 retryFailed 가 아무것도 재생하지 않는다', async () => {
    const t1 = makeTask({ id: 't1', status: 'todo' })
    const t2 = makeTask({ id: 't2', status: 'todo' })
    const { cache, calls, mover, patchTask, onFailure } = setup(t1, [])
    cache.set('t2', t2)

    mover.move('t1', 'done')
    mover.move('t2', 'in-progress')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    calls[1].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()
    expect(onFailure.mock.calls[1][1]).toBe(2) // 큐 2건

    mover.discardFailed() // 요청 취소: 의도 폐기 (화면은 이미 롤백된 상태)
    mover.retryFailed()
    expect(patchTask).toHaveBeenCalledTimes(2) // 추가 요청 없음
    expect(cache.get('t1')!.status).toBe('todo') // 롤백 상태 유지
    expect(cache.get('t2')!.status).toBe('todo')

    // 폐기 후 새 실패는 1건부터 다시 센다
    mover.move('t1', 'done')
    calls[2].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()
    expect(onFailure.mock.calls[2][1]).toBe(1)
  })

  it('같은 컬럼 드롭(no-op)은 큐에 있던 그 카드의 실패 의도를 지우지 않는다', async () => {
    const { calls, mover, patchTask } = setup(makeTask(), [])
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush() // 롤백됨 (todo) + 큐 1건

    mover.move('t1', 'todo') // 롤백된 자리에 같은 컬럼 드롭 = no-op
    expect(patchTask).toHaveBeenCalledTimes(1) // 요청 없음

    mover.retryFailed() // 큐의 의도는 살아 있어야 함
    expect(patchTask).toHaveBeenCalledTimes(2)
    expect(calls[1].patch).toMatchObject({ status: 'done' })
  })

  it('409 는 재시도하지 않는다 (같은 version 으론 영원히 실패하므로)', async () => {
    const { cache, calls, mover, patchTask, onFailure } = setup(makeTask(), [0, 0, 0])
    const serverCurrent = makeTask({ status: 'in-progress', version: 5 })
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(409, '다른 곳에서 먼저 수정되었습니다.', { current: serverCurrent }))
    await flush()

    expect(patchTask).toHaveBeenCalledTimes(1) // 재시도 없음
    expect(cache.get('t1')).toEqual(serverCurrent)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})

describe('createTaskMover — 오프라인', () => {
  function offlineSetup() {
    const net = { online: false }
    const base = setup()
    const mover = createTaskMover({
      patchTask: base.patchTask,
      postTask: base.postTask,
      removeTask: base.removeTask,
      readTask: (id) => base.cache.get(id),
      writeTask: (t) => base.cache.set(t.id, t),
      dropTask: (id) => base.cache.delete(id),
      onFailure: base.onFailure,
      retryDelays: [],
      isOnline: () => net.online,
    })
    return { ...base, mover, net }
  }

  it('오프라인 이동은 화면에 즉시 반영하되, 전송은 하지 않고 큐에 보류한다', () => {
    const { cache, mover, patchTask, onFailure } = offlineSetup()
    mover.move('t1', 'done')

    expect(patchTask).not.toHaveBeenCalled() // 네트워크 시도 자체가 없음
    expect(cache.get('t1')!.status).toBe('done') // 즉각 반응 (사용자 결정)
    expect(onFailure).toHaveBeenCalledWith('네트워크 연결을 확인해주세요.', 1)
  })

  it('오프라인 연속 이동은 한 건으로 병합되고, 복구 후 서버 기준 version 으로 전송된다', async () => {
    const { cache, calls, mover, patchTask, net } = offlineSetup()
    mover.move('t1', 'done')
    mover.move('t1', 'in-progress')
    expect(cache.get('t1')!.status).toBe('in-progress') // 화면은 최신 목표

    net.online = true
    mover.retryFailed()
    expect(patchTask).toHaveBeenCalledTimes(1) // 병합된 1건만
    expect(calls[0].patch).toEqual({ status: 'in-progress', version: 1 }) // baseline 의 version

    calls[0].d.resolve(makeTask({ status: 'in-progress', version: 2 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'in-progress', version: 2 })
  })

  it('오프라인 이동을 요청 취소하면 화면도 서버 상태로 되돌린다', () => {
    const { cache, mover } = offlineSetup()
    mover.move('t1', 'done')
    expect(cache.get('t1')!.status).toBe('done')

    mover.discardFailed() // 화면이 앞서 나가 있으므로 폐기는 곧 화면 원복
    expect(cache.get('t1')).toMatchObject({ status: 'todo', version: 1 })
  })

  it('생성/삭제도 오프라인이면 즉시 알리고 큐에 쌓는다', () => {
    const { cache, mover, postTask, removeTask, onFailure } = offlineSetup()
    mover.create({ title: '새 태스크' })
    mover.remove('t1')

    expect(postTask).not.toHaveBeenCalled()
    expect(removeTask).not.toHaveBeenCalled()
    expect(cache.has('t1')).toBe(true) // 삭제도 보류 — 카드 유지
    expect(onFailure).toHaveBeenCalledTimes(2)
    expect(onFailure.mock.calls[1][1]).toBe(2) // 큐 2건 누적
  })

  it('동일 내용의 생성을 반복해도 실패 큐에는 한 건으로 합쳐진다', () => {
    const { mover, onFailure, postTask } = offlineSetup()
    mover.create({ title: '같은 태스크' })
    mover.create({ title: '같은 태스크' })
    mover.create({ title: '같은 태스크' })

    expect(postTask).not.toHaveBeenCalled()
    // 세 번 알리지만 큐는 계속 1건 (내용 기반 키로 병합)
    expect(onFailure.mock.calls.map((c) => c[1])).toEqual([1, 1, 1])
  })

  it('여전히 오프라인일 때 재시도하면 전송 없이 다시 큐에 남고 알림이 반복된다', () => {
    const { mover, onFailure, patchTask } = offlineSetup()
    mover.move('t1', 'done')
    mover.retryFailed() // 아직 오프라인

    expect(patchTask).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledTimes(2) // 계속 알림
    expect(onFailure.mock.calls[1][1]).toBe(1) // 큐 유지
  })

  it('온라인 복귀 후 retryFailed 가 대기 큐를 그대로 전송한다', async () => {
    const { cache, calls, mover, patchTask, net } = offlineSetup()
    mover.move('t1', 'done')
    expect(patchTask).not.toHaveBeenCalled()

    net.online = true
    mover.retryFailed()
    expect(cache.get('t1')!.status).toBe('done') // 낙관 상태 유지
    expect(patchTask).toHaveBeenCalledTimes(1)
    expect(calls[0].patch).toEqual({ status: 'done', version: 1 }) // 서버 기준 version

    calls[0].d.resolve(makeTask({ status: 'done', version: 2 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ status: 'done', version: 2 })
  })
})

describe('createTaskMover — 서버 확정 알림 (다중 탭 방송용)', () => {
  it('수정/생성이 서버에서 확정될 때만 onCommitted 가 서버 값으로 호출된다', async () => {
    const onCommitted = vi.fn()
    const { calls, postCalls, mover } = setup(makeTask(), [], { onCommitted })

    mover.move('t1', 'done')
    expect(onCommitted).not.toHaveBeenCalled() // 낙관 반영 시점엔 호출 안 됨

    const server = makeTask({ status: 'done', version: 2 })
    calls[0].d.resolve(server)
    await flush()
    expect(onCommitted).toHaveBeenCalledWith(server)

    mover.create({ title: '새 카드' })
    const created = makeTask({ id: 'srv-1', title: '새 카드', version: 1 })
    postCalls[0].d.resolve(created)
    await flush()
    expect(onCommitted).toHaveBeenCalledWith(created)
  })

  it('실패하면 onCommitted 는 호출되지 않는다', async () => {
    const onCommitted = vi.fn()
    const { calls, mover } = setup(makeTask(), [], { onCommitted })
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '오류', null))
    await flush()
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it('삭제가 서버에서 확정되면 onRemoved 가 호출된다', async () => {
    const onRemoved = vi.fn()
    const { removeCalls, mover } = setup(makeTask(), [], { onRemoved })
    mover.remove('t1')
    expect(onRemoved).not.toHaveBeenCalled() // 낙관적 제거 시점엔 아직
    removeCalls[0].d.resolve()
    await flush()
    expect(onRemoved).toHaveBeenCalledWith('t1')
  })
})

describe('createTaskMover — 의도 정산 (재시도 진행 표시용)', () => {
  it('의도가 성공으로 확정되면 onIntentSettled(key, true) 가 호출된다', async () => {
    const onIntentSettled = vi.fn()
    const { calls, removeCalls, mover } = setup(makeTask(), [], { onIntentSettled })

    mover.move('t1', 'done')
    calls[0].d.resolve(makeTask({ status: 'done', version: 2 }))
    await flush()
    expect(onIntentSettled).toHaveBeenCalledWith('t1', true)

    mover.remove('t1')
    removeCalls[0].d.resolve()
    await flush()
    expect(onIntentSettled).toHaveBeenCalledWith('t1', true)
  })

  it('자동 재시도까지 소진해 실패로 확정되면 onIntentSettled(key, false) 가 호출된다', async () => {
    const onIntentSettled = vi.fn()
    const { calls, mover } = setup(makeTask(), [], { onIntentSettled })
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(500, '오류', null))
    await flush()
    expect(onIntentSettled).toHaveBeenCalledWith('t1', false)
  })
})

describe('createTaskMover — 409 충돌과 가드', () => {
  it('409 충돌 시 서버 최신 상태를 채택하고 알린다', async () => {
    const { cache, calls, mover, onFailure } = setup()
    const serverCurrent = makeTask({ status: 'in-progress', version: 5, title: '서버에서 수정됨' })
    mover.move('t1', 'done')
    calls[0].d.reject(new ApiError(409, '다른 곳에서 먼저 수정되었습니다.', { current: serverCurrent }))
    await flush()
    expect(cache.get('t1')).toEqual(serverCurrent)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('같은 컬럼으로의 드롭(no-op)은 요청을 보내지 않는다', () => {
    const { mover, patchTask, cache } = setup()
    mover.move('t1', 'todo') // 이미 todo
    expect(patchTask).not.toHaveBeenCalled()
    expect(cache.get('t1')!.status).toBe('todo')
  })

  it('존재하지 않는 카드 이동은 무시한다', () => {
    const { mover, patchTask } = setup()
    mover.move('ghost', 'done')
    expect(patchTask).not.toHaveBeenCalled()
  })
})

describe('createTaskMover — update (move 의 일반화)', () => {
  it('필드 수정은 즉시 낙관적으로 반영되고 서버 응답으로 커밋된다', async () => {
    const { cache, calls, mover } = setup()
    mover.update('t1', { title: '수정된 제목', priority: 'high' })
    expect(cache.get('t1')).toMatchObject({ title: '수정된 제목', priority: 'high' })
    expect(calls[0].patch).toEqual({ title: '수정된 제목', priority: 'high', version: 1 })

    calls[0].d.resolve(makeTask({ title: '수정된 제목', priority: 'high', version: 2 }))
    await flush()
    expect(cache.get('t1')).toMatchObject({ title: '수정된 제목', priority: 'high', version: 2 })
  })

  it('진행 중에 온 수정은 patch 로 병합된다: 늦은 응답이 낙관적 필드를 덮지 않는다', async () => {
    const { cache, calls, mover } = setup()
    mover.update('t1', { title: '1차 제목' })
    mover.update('t1', { description: '설명 추가' }) // 진행 중이라 nextPatch 로 병합

    expect(calls).toHaveLength(1)
    calls[0].d.resolve(makeTask({ title: '1차 제목', version: 2 }))
    await flush()

    expect(calls).toHaveLength(2)
    expect(calls[1].patch).toEqual({ description: '설명 추가', version: 2 })
    expect(cache.get('t1')).toMatchObject({ title: '1차 제목', description: '설명 추가', version: 2 })
  })

  it('update 실패 시 baseline 으로 롤백하고, 실패 큐엔 병합된 patch 로 쌓여 retryFailed 로 재전송된다', async () => {
    const { cache, calls, mover, onFailure } = setup(makeTask(), [])
    mover.update('t1', { title: '실패할 수정' })
    calls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()
    expect(cache.get('t1')).toMatchObject({ title: '테스트 태스크' }) // baseline 으로 롤백
    expect(onFailure).toHaveBeenCalledTimes(1)

    mover.retryFailed()
    expect(calls).toHaveLength(2)
    expect(calls[1].patch).toEqual({ title: '실패할 수정', version: 1 })
  })

  it('patch 의 모든 키가 local 과 같으면 요청을 보내지 않는다 (no-op 가드)', () => {
    const { mover, patchTask } = setup()
    mover.update('t1', { title: '테스트 태스크', status: 'todo' })
    expect(patchTask).not.toHaveBeenCalled()
  })
})

describe('createTaskMover — create', () => {
  it('임시 카드를 즉시 맨 앞에 삽입하고, 성공하면 서버 카드로 교체한다(임시 id 사라짐)', async () => {
    const { cache, postCalls, mover } = setup()
    mover.create({ title: '새 태스크', priority: 'high', status: 'todo' })

    const tempId = [...cache.keys()].find((id) => id.startsWith('temp-'))
    expect(tempId).toBeDefined()
    expect(cache.get(tempId!)).toMatchObject({ title: '새 태스크', priority: 'high', status: 'todo' })
    expect([...cache.keys()][0]).toBe(tempId) // 맨 앞에 삽입
    expect(postCalls[0].input).toEqual({ title: '새 태스크', priority: 'high', status: 'todo' })

    postCalls[0].d.resolve(makeTask({ id: 'server-1', title: '새 태스크', priority: 'high' }))
    await flush()

    expect(cache.has(tempId!)).toBe(false)
    expect(cache.get('server-1')).toMatchObject({ title: '새 태스크' })
  })

  it('생성 실패 시 임시 카드를 제거하고 실패 큐에 쌓는다. retryFailed 로 같은 입력을 재생성한다', async () => {
    const { cache, postCalls, mover, onFailure } = setup(makeTask(), [])
    mover.create({ title: '실패할 생성', priority: 'low', status: 'todo' })
    const tempId = [...cache.keys()].find((id) => id.startsWith('temp-'))!

    postCalls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()

    expect(cache.has(tempId)).toBe(false)
    expect(onFailure).toHaveBeenCalledTimes(1)

    mover.retryFailed()
    expect(postCalls).toHaveLength(2)
    expect(postCalls[1].input).toEqual({ title: '실패할 생성', priority: 'low', status: 'todo' })
    const newTempId = [...cache.keys()].find((id) => id.startsWith('temp-'))
    expect(newTempId).toBeDefined()
    expect(newTempId).not.toBe(tempId)
  })
})

describe('createTaskMover — remove', () => {
  it('즉시 캐시에서 제거하고, 성공하면 그대로 끝난다', async () => {
    const { cache, removeCalls, mover } = setup()
    mover.remove('t1')
    expect(cache.has('t1')).toBe(false)

    removeCalls[0].d.resolve()
    await flush()
    expect(cache.has('t1')).toBe(false)
  })

  it('삭제 실패 시 스냅샷으로 복원하고 실패 큐에 쌓는다. retryFailed 로 재삭제한다', async () => {
    const { cache, removeCalls, mover, onFailure } = setup(makeTask(), [])
    mover.remove('t1')
    removeCalls[0].d.reject(new ApiError(500, '일시적인 서버 오류입니다.', null))
    await flush()

    expect(cache.get('t1')).toMatchObject({ title: '테스트 태스크' }) // 복원
    expect(onFailure).toHaveBeenCalledTimes(1)

    mover.retryFailed()
    expect(removeCalls).toHaveLength(2)
    expect(cache.has('t1')).toBe(false)
  })
})

describe('createTaskMover — 임시 카드 가드', () => {
  it('temp- 로 시작하는 카드에 대한 update/remove/move 는 무시한다 (서버 id 가 아직 없음)', () => {
    const { mover, patchTask, removeTask } = setup()
    mover.update('temp-abc', { title: 'x' })
    mover.remove('temp-abc')
    mover.move('temp-abc', 'done')
    expect(patchTask).not.toHaveBeenCalled()
    expect(removeTask).not.toHaveBeenCalled()
  })
})
