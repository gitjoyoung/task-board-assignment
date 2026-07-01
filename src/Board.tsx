import { useEffect, useMemo, useState } from 'react'
import type { Task, Status } from './types'
import { getTasks } from './api/client'
import { Column } from './components/Column'

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'To Do' },
  { status: 'in-progress', title: 'In Progress' },
  { status: 'done', title: 'Done' },
]

export default function Board() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 순진한 초기 로드: 로딩만 처리합니다.
    // TODO(P1): 에러 상태 + 재시도, 빈 상태 처리를 구현하세요.
    getTasks()
      .then((data) => setTasks(data))
      .finally(() => setLoading(false))
  }, [])

  // ⚠️ 서버에 저장하지 않고 로컬 상태만 바꾸는 "순진한" 이동입니다.
  // TODO(P1): 낙관적 업데이트 + 실패 시 롤백 + 경쟁 상태 처리를 구현하세요.
  //   - updateTask(id, { status, version }) 로 서버에 반영
  //   - 실패(15%)하면 이전 상태로 되돌리고 사용자에게 알림
  //   - 같은 카드를 빠르게 연속 이동해도 최종 상태가 서버와 일치하도록
  const moveTask = (id: string, status: Status) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
  }

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
    for (const t of tasks) map[t.status].push(t)
    return map
  }, [tasks])

  if (loading) return <p className="hint">불러오는 중…</p>

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
