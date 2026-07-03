import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task, Status, Priority } from './types'
import { getTasks, updateTask, createTask, deleteTask } from './api/client'
import { createTaskMover } from './lib/taskMover'
import { filterTasks } from './lib/tasks'
import { useDebouncedValue } from './lib/useDebouncedValue'
import { Column } from './components/Column'
import { TaskDialog, type TaskDialogInput } from './components/TaskDialog'

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

  const [notice, setNotice] = useState<{ message: string; failedCount: number } | null>(null)
  const noticeTimer = useRef<number>()
  // 검색어 입력창은 즉시 반응하고, 실제 필터링(디바운스된 값)만 250ms 지연시킨다
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const debouncedQuery = useDebouncedValue(query)
  const [dialog, setDialog] = useState<
    { mode: 'create'; status: Status } | { mode: 'edit'; task: Task } | null
  >(null)

  // 낙관적 CRUD + 롤백 + 카드별 직렬화 (로직은 src/lib/taskMover.ts, 테스트 포함)
  const mover = useMemo(
    () =>
      createTaskMover({
        patchTask: updateTask,
        postTask: createTask,
        removeTask: deleteTask,
        readTask: (id) =>
          queryClient.getQueryData<Task[]>(TASKS_KEY)?.find((t) => t.id === id),
        writeTask: (task) =>
          queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) => {
            if (!prev) return prev
            const exists = prev.some((t) => t.id === task.id)
            return exists ? prev.map((t) => (t.id === task.id ? task : t)) : [task, ...prev]
          }),
        dropTask: (id) =>
          queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) => prev?.filter((t) => t.id !== id)),
        onFailure: (message, failedCount) => {
          setNotice({ message, failedCount })
          window.clearTimeout(noticeTimer.current)
          // 재시도할 실패 건이 있으면 사용자가 처리할 때까지 알림을 유지한다
          if (failedCount === 0)
            noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
        },
      }),
    [queryClient],
  )

  // 네트워크 복구 시 대기 중이던 실패 큐를 자동 재전송한다.
  // 알림도 함께 닫는다 — 재전송이 또 실패하면 onFailure 가 다시 띄운다.
  useEffect(() => {
    const onOnline = () => {
      mover.retryFailed()
      setNotice(null)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [mover])

  const moveTask = (id: string, status: Status) => mover.move(id, status)

  const handleSave = (input: TaskDialogInput) => {
    if (dialog?.mode === 'edit') mover.update(dialog.task.id, input)
    else if (dialog?.mode === 'create') mover.create({ ...input, status: dialog.status })
  }

  const byStatus = useMemo(() => {
    const filtered = filterTasks(tasks ?? [], { query: debouncedQuery, priority })
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of filtered) map[t.status].push(t)
    return map
  }, [tasks, debouncedQuery, priority])

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
        <button onClick={() => setDialog({ mode: 'create', status: 'todo' })}>
          태스크 추가
        </button>
        <TaskDialog
          open={dialog !== null}
          onClose={() => setDialog(null)}
          onSave={handleSave}
        />
      </div>
    )

  return (
    <>
      <div className="board-toolbar">
        <input
          type="search"
          placeholder="제목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority | 'all')}
        >
          <option value="all">전체 우선순위</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div className="board">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            title={col.title}
            status={col.status}
            tasks={byStatus[col.status]}
            onMove={moveTask}
            onAdd={(status) => setDialog({ mode: 'create', status })}
            onEdit={(task) => setDialog({ mode: 'edit', task })}
          />
        ))}
      </div>
      <TaskDialog
        open={dialog !== null}
        task={dialog?.mode === 'edit' ? dialog.task : undefined}
        onClose={() => setDialog(null)}
        onSave={handleSave}
        onDelete={(id) => mover.remove(id)}
      />
      {notice && (
        <div className="toast" role="alert">
          <span>
            {notice.failedCount > 1
              ? `변경 ${notice.failedCount}건이 저장되지 않았습니다.`
              : notice.message}
          </span>
          {/* 두 선택지로 모든 실패가 명시적으로 해소된다 (숨김 상태의 유령 큐 없음).
              토스트는 비차단이라 결정을 미뤄도 작업엔 지장이 없다. */}
          {notice.failedCount > 0 && (
            <>
              <button
                onClick={() => {
                  mover.retryFailed()
                  setNotice(null)
                }}
              >
                {notice.failedCount > 1 ? `${notice.failedCount}건 재시도` : '재시도'}
              </button>
              <button
                onClick={() => {
                  // 실패한 변경 의도를 폐기한다 (화면은 이미 롤백됨).
                  mover.discardFailed()
                  setNotice(null)
                }}
              >
                요청 취소
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
