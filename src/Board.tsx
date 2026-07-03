import { useMemo, useState } from 'react'
import type { Task, Status, Priority } from './types'
import { useTasksQuery } from './hooks/useTasksQuery'
import { useTaskSync } from './hooks/useTaskSync'
import { filterTasks, groupByStatus } from './lib/tasks'
import { useDebouncedValue } from './lib/useDebouncedValue'
import { Column } from './components/Column'
import { BoardToolbar } from './components/BoardToolbar'
import { FailureToast } from './components/FailureToast'
import { TaskDialog, type TaskDialogInput } from './components/TaskDialog'

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

type DialogState = { mode: 'create'; status: Status } | { mode: 'edit'; task: Task } | null

export default function Board() {
  const { data: tasks, isPending, isError, error, refetch, isRefetching } = useTasksQuery()
  const { mover, notice, dismissNotice } = useTaskSync()

  // 화면 전용 상태: 검색/필터/다이얼로그
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const debouncedQuery = useDebouncedValue(query) // 입력은 즉시, 필터링만 250ms 지연
  const [dialog, setDialog] = useState<DialogState>(null)

  const byStatus = useMemo(
    () => groupByStatus(filterTasks(tasks ?? [], { query: debouncedQuery, priority })),
    [tasks, debouncedQuery, priority],
  )

  const handleSave = (input: TaskDialogInput) => {
    if (dialog?.mode === 'edit') mover.update(dialog.task.id, input)
    else if (dialog?.mode === 'create') mover.create({ ...input, status: dialog.status })
  }

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
        <button onClick={() => setDialog({ mode: 'create', status: 'todo' })}>태스크 추가</button>
        <TaskDialog open={dialog !== null} onClose={() => setDialog(null)} onSave={handleSave} />
      </div>
    )

  return (
    <>
      <BoardToolbar
        query={query}
        priority={priority}
        onQueryChange={setQuery}
        onPriorityChange={setPriority}
      />
      <div className="board">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            title={col.title}
            status={col.status}
            tasks={byStatus[col.status]}
            onMove={mover.move}
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
        onDelete={mover.remove}
      />
      {notice && (
        <FailureToast
          notice={notice}
          items={notice.items}
          onRetry={() => {
            mover.retryFailed()
            dismissNotice()
          }}
          onDiscard={() => {
            mover.discardFailed()
            dismissNotice()
          }}
        />
      )}
    </>
  )
}
