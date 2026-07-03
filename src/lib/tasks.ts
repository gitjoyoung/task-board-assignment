import type { Task, Status, Priority } from '../types'

/**
 * 순수 함수 예시 — 이런 로직을 테스트로 검증하세요. (tasks.test.ts 참고)
 * 필요하면 자유롭게 수정/삭제해도 됩니다.
 */
export function moveTask(tasks: Task[], id: string, status: Status): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, status } : t))
}

export function filterByTitle(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return tasks
  return tasks.filter((t) => t.title.toLowerCase().includes(q))
}

export function filterByPriority(tasks: Task[], priority: Priority | 'all'): Task[] {
  if (priority === 'all') return tasks
  return tasks.filter((t) => t.priority === priority)
}

// 제목 검색과 우선순위 필터를 AND 로 결합한다.
export function filterTasks(
  tasks: Task[],
  f: { query: string; priority: Priority | 'all' },
): Task[] {
  return filterByPriority(filterByTitle(tasks, f.query), f.priority)
}

/** 상태별 컬럼 분배. 원본 배열 순서를 보존한다. */
export function groupByStatus(tasks: Task[]): Record<Status, Task[]> {
  const map: Record<Status, Task[]> = { todo: [], 'in-progress': [], done: [] }
  for (const t of tasks) map[t.status].push(t)
  return map
}
