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
