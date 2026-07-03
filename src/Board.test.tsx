import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Board from './Board'
import type { Task } from './types'
import * as api from './api/client'

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getTasks: vi.fn(),
  updateTask: vi.fn(),
}))

const mockedGetTasks = vi.mocked(api.getTasks)

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

function renderBoard() {
  // 테스트에선 자동 재시도를 꺼서 에러 분기를 즉시 검증한다.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Board />
    </QueryClientProvider>,
  )
}

const mockedUpdateTask = vi.mocked(api.updateTask)

beforeEach(() => {
  mockedGetTasks.mockReset()
  mockedUpdateTask.mockReset()
})

describe('Board 로드 상태', () => {
  it('로딩 중이면 로딩 문구를 보여준다', () => {
    mockedGetTasks.mockReturnValue(new Promise(() => {}))
    renderBoard()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
  })

  it('로드 실패 시 에러와 재시도 버튼을 보여주고, 재시도가 성공하면 보드를 렌더한다', async () => {
    mockedGetTasks
      .mockRejectedValueOnce(new Error('일시적인 서버 오류'))
      .mockResolvedValueOnce([makeTask()])
    renderBoard()

    expect(await screen.findByRole('alert')).toHaveTextContent('태스크를 불러오지 못했습니다.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('테스트 태스크')).toBeInTheDocument()
    expect(mockedGetTasks).toHaveBeenCalledTimes(2)
  })

  it('태스크가 0개면 빈 상태를 보여준다', async () => {
    mockedGetTasks.mockResolvedValue([])
    renderBoard()
    expect(await screen.findByText('태스크가 없습니다.')).toBeInTheDocument()
  })

  it('로드 성공 시 태스크를 상태별 컬럼에 렌더한다', async () => {
    mockedGetTasks.mockResolvedValue([
      makeTask({ id: 'a', title: '할 일', status: 'todo' }),
      makeTask({ id: 'b', title: '진행 중 작업', status: 'in-progress' }),
      makeTask({ id: 'c', title: '끝난 일', status: 'done' }),
    ])
    renderBoard()

    expect(await screen.findByText('할 일')).toBeInTheDocument()
    expect(screen.getByText('진행 중 작업')).toBeInTheDocument()
    expect(screen.getByText('끝난 일')).toBeInTheDocument()
  })
})

describe('Board 통합 — 낙관 반영 → 롤백 → 재시도', () => {
  it('이동 실패 시 상세 알림이 뜨고 롤백되며, 재시도가 성공하면 알림이 닫힌다', async () => {
    const task = makeTask({ id: 'a', title: '통합 카드', status: 'todo', version: 1 })
    mockedGetTasks.mockResolvedValue([task])
    mockedUpdateTask
      .mockRejectedValueOnce(new Error('서버 오류')) // 최초 시도
      .mockRejectedValueOnce(new Error('서버 오류')) // 자동 재시도 1회
      .mockResolvedValueOnce({ ...task, status: 'done', version: 2 }) // 수동 재시도

    const { container } = renderBoard()
    await screen.findByText('통합 카드')
    const columns = container.querySelectorAll('.column')

    // Done 컬럼에 드롭 → 낙관 반영
    fireEvent.drop(columns[2], { dataTransfer: { getData: () => 'a' } })
    // Query v5 는 캐시 알림을 마이크로태스크로 배치하므로 waitFor 로 확인
    await waitFor(() => expect(columns[2]).toHaveTextContent('통합 카드'))

    // 자동 재시도 소진 후 실패 확정: 상세 알림 + 롤백
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '변경 1건이 저장되지 않았습니다.',
    )
    expect(screen.getByText('이동: “통합 카드” — To Do → Done')).toBeInTheDocument()
    expect(columns[0]).toHaveTextContent('통합 카드') // 롤백

    // 수동 재시도 → 성공 → 알림 닫힘 + 이동 확정
    fireEvent.click(screen.getByRole('button', { name: '재시도' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(columns[2]).toHaveTextContent('통합 카드')
    expect(mockedUpdateTask).toHaveBeenCalledTimes(3)
  })
})
