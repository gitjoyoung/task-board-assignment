import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task, Status } from './types'
import { getTasks } from './api/client'
import { Column } from './components/Column'

export const TASKS_KEY = ['tasks'] as const

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

export default function Board() {
  const queryClient = useQueryClient()
  const {
    data: tasks,
    isPending,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: TASKS_KEY,
    queryFn: ({ signal }) => getTasks(signal),
  })

  // TODO(P1-2): 낙관적 업데이트 + 실패 시 롤백 + 경쟁 상태 처리 (다음 단계)
  const moveTask = (id: string, status: Status) => {
    queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) =>
      prev?.map((t) => (t.id === id ? { ...t, status } : t)),
    )
  }

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks ?? []) map[t.status].push(t)
    return map
  }, [tasks])

  if (isPending) return <p className="hint">불러오는 중…</p>

  if (isError)
    return (
      <div className="board-state" role="alert">
        <p>태스크를 불러오지 못했습니다.</p>
        <p className="hint">{error.message}</p>
        <button onClick={() => refetch()} disabled={isRefetching}>
          {isRefetching ? '재시도 중…' : '다시 시도'}
        </button>
      </div>
    )

  if (tasks.length === 0)
    return (
      <div className="board-state">
        <p>태스크가 없습니다.</p>
        <p className="hint">첫 태스크를 추가해 보세요.</p>
      </div>
    )

  return (
    <div className="board">
      {COLUMNS.map((col) => (
        <Column
          key={col.status}
          title={col.title}
          status={col.status}
          tasks={byStatus[col.status]}
          onMove={moveTask}
        />
      ))}
    </div>
  )
}
