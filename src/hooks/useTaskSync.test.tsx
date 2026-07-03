import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Task } from '../types'
import * as api from '../api/client'
import { useTaskSync } from './useTaskSync'
import { TASKS_KEY } from './useTasksQuery'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTasks: vi.fn(),
  updateTask: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
}))

const mockedUpdate = vi.mocked(api.updateTask)

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 'a',
    title: '동기화 카드',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

/** 독립된 QueryClient 를 가진 "탭" 하나를 만든다. */
function setupTab(seed: Task[]) {
  const client = new QueryClient()
  client.setQueryData(TASKS_KEY, seed)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useTaskSync(), { wrapper })
  return { client, hook }
}

beforeEach(() => {
  mockedUpdate.mockReset()
})

describe('useTaskSync — 실패 알림 스냅샷', () => {
  it('알림의 실패 목록은 알림 시점에 고정된다 (재전송 중 출렁이지 않음)', async () => {
    const tab = setupTab([makeTask()])
    mockedUpdate
      .mockRejectedValueOnce(new Error('서버 오류')) // 첫 시도
      .mockRejectedValueOnce(new Error('서버 오류')) // 자동 재시도 1회 → 실패 확정
      .mockReturnValueOnce(new Promise(() => {})) // 수동 재이동은 계속 진행 중

    act(() => tab.hook.result.current.mover.move('a', 'done'))
    await waitFor(() => expect(tab.hook.result.current.notice).not.toBeNull())
    const itemsAtNotice = tab.hook.result.current.notice!.items
    expect(itemsAtNotice).toHaveLength(1)

    // 실패한 카드를 손으로 다시 이동 → 큐에서는 빠지지만(재전송 중)
    // 알림 목록은 스냅샷이라 그대로여야 한다
    act(() => tab.hook.result.current.mover.move('a', 'done'))
    expect(tab.hook.result.current.notice!.items).toBe(itemsAtNotice)
  })
})

describe('useTaskSync — 재시도 해소 대기', () => {
  it('재시도 중 성공한 항목은 목록에서 빠지고, 전부 해소되면 알림이 닫힌다', async () => {
    const tab = setupTab([makeTask({ id: 'a' }), makeTask({ id: 'b', title: '두 번째 카드' })])
    // 두 카드 모두 실패 확정 (각 2회 거절)
    mockedUpdate.mockRejectedValue(new Error('서버 오류'))

    act(() => {
      tab.hook.result.current.mover.move('a', 'done')
      tab.hook.result.current.mover.move('b', 'done')
    })
    await waitFor(() => expect(tab.hook.result.current.notice?.items).toHaveLength(2))

    // 재시도: a 는 성공, b 는 또 실패
    mockedUpdate.mockReset()
    mockedUpdate.mockImplementation((id: string) =>
      id === 'a'
        ? Promise.resolve(makeTask({ id: 'a', status: 'done', version: 2 }))
        : Promise.reject(new Error('서버 오류')),
    )
    act(() => tab.hook.result.current.mover.retryFailed())

    // a 행만 빠지고 알림은 유지된다
    await waitFor(() => expect(tab.hook.result.current.notice?.items).toHaveLength(1))
    expect(tab.hook.result.current.notice!.items[0].key).toBe('b')

    // 다시 재시도: b 도 성공 → 알림이 닫힌다
    mockedUpdate.mockResolvedValue(makeTask({ id: 'b', status: 'done', version: 2 }))
    act(() => tab.hook.result.current.mover.retryFailed())
    await waitFor(() => expect(tab.hook.result.current.notice).toBeNull())
  })
})

describe('useTaskSync — 이동 카드의 표시 위치', () => {
  it('컬럼이 바뀐 카드는 배열 맨 앞으로 온다 (가상화 창 밖으로 사라지지 않게)', async () => {
    // 앞에 다른 카드들이 있어도, 이동한 카드가 대상 컬럼 최상단에 보여야 한다
    const others = Array.from({ length: 3 }, (_, i) =>
      makeTask({ id: `done-${i}`, status: 'done' }),
    )
    const tab = setupTab([...others, makeTask({ id: 'a', status: 'todo' })])
    mockedUpdate.mockResolvedValue(makeTask({ id: 'a', status: 'done', version: 2 }))

    act(() => tab.hook.result.current.mover.move('a', 'done'))
    await waitFor(() => {
      const tasks = tab.client.getQueryData<Task[]>(TASKS_KEY)!
      expect(tasks[0]).toMatchObject({ id: 'a', status: 'done', version: 2 })
    })
  })
})

describe('useTaskSync — 재시도 진행 표시', () => {
  it('retryAll 동안 retrying 이 켜지고, 재실패가 확정되면 꺼진다', async () => {
    const tab = setupTab([makeTask()])
    mockedUpdate.mockRejectedValue(new Error('서버 오류'))
    act(() => tab.hook.result.current.mover.move('a', 'done'))
    await waitFor(() => expect(tab.hook.result.current.notice).not.toBeNull())
    expect(tab.hook.result.current.notice!.retrying).toBeFalsy()

    act(() => tab.hook.result.current.retryAll())
    expect(tab.hook.result.current.notice!.retrying).toBe(true) // 진행 표시 켜짐

    // 재실패 확정(자동 재시도 포함 2회 거절) → 진행 표시 해제 + 행 유지
    await waitFor(() => expect(tab.hook.result.current.notice!.retrying).toBe(false))
    expect(tab.hook.result.current.notice!.items).toHaveLength(1)
  })
})

describe('useTaskSync — 네트워크 복구', () => {
  it('복구 자동 재전송 중에도 알림이 유지된다 (닫았다 다시 뜨는 깜빡임 회귀 방지)', async () => {
    const tab = setupTab([makeTask()])
    mockedUpdate
      .mockRejectedValueOnce(new Error('서버 오류'))
      .mockRejectedValueOnce(new Error('서버 오류')) // 실패 확정 → 큐 적재
    act(() => tab.hook.result.current.mover.move('a', 'done'))
    await waitFor(() => expect(tab.hook.result.current.notice).not.toBeNull())

    mockedUpdate.mockReturnValueOnce(new Promise(() => {})) // 재전송은 계속 진행 중
    act(() => window.dispatchEvent(new Event('online')))

    expect(mockedUpdate).toHaveBeenCalledTimes(3) // 자동 재전송은 발사됐고
    expect(tab.hook.result.current.notice).not.toBeNull() // 알림은 닫히지 않았다
  })
})

describe('useTaskSync — 다중 탭 동기화', () => {
  it('한 탭의 서버 확정 변경이 다른 탭 캐시에 반영된다 (재조회 없이)', async () => {
    const task = makeTask()
    const tabA = setupTab([task])
    const tabB = setupTab([task])
    mockedUpdate.mockResolvedValue(makeTask({ status: 'done', version: 2 }))

    act(() => tabA.hook.result.current.mover.move('a', 'done'))

    await waitFor(() => {
      const tasks = tabB.client.getQueryData<Task[]>(TASKS_KEY)!
      expect(tasks.find((t) => t.id === 'a')).toMatchObject({ status: 'done', version: 2 })
    })
  })

  it('낡은 방송은 더 새로운 캐시를 덮지 않는다 (version 가드)', async () => {
    const tabA = setupTab([makeTask({ version: 1 })])
    const tabB = setupTab([makeTask({ status: 'in-progress', version: 5 })])
    mockedUpdate.mockResolvedValue(makeTask({ status: 'done', version: 2 })) // v5 보다 낡음

    act(() => tabA.hook.result.current.mover.move('a', 'done'))
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50)) // 방송 전파 여유

    const tasks = tabB.client.getQueryData<Task[]>(TASKS_KEY)!
    expect(tasks.find((t) => t.id === 'a')).toMatchObject({ status: 'in-progress', version: 5 })
  })
})
