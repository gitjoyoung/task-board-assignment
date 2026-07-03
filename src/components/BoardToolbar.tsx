import type { Priority } from '../types'

interface Props {
  query: string
  priority: Priority | 'all'
  onQueryChange: (query: string) => void
  onPriorityChange: (priority: Priority | 'all') => void
}

/** 검색·필터 입력. 상태는 갖지 않는 프레젠테이션 컴포넌트. */
export function BoardToolbar({ query, priority, onQueryChange, onPriorityChange }: Props) {
  return (
    <div className="board-toolbar">
      <input
        type="search"
        placeholder="제목 검색"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <select
        value={priority}
        onChange={(e) => onPriorityChange(e.target.value as Priority | 'all')}
      >
        <option value="all">전체 우선순위</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </div>
  )
}
