import type { Task, Status } from '../types'
import { Card } from './Card'

interface Props {
  title: string
  status: Status
  tasks: Task[]
  onMove: (id: string, status: Status) => void
}

export function Column({ title, status, tasks, onMove }: Props) {
  return (
    <section
      className="column"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/plain')
        if (id) onMove(id, status)
      }}
    >
      <h2 className="column-title">
        {title} <span className="count">{tasks.length}</span>
      </h2>
      <div className="column-body">
        {/* ⚠️ 5,000개를 그대로 렌더합니다. 대량 데이터 성능 최적화는 당신의 몫입니다. */}
        {tasks.map((t) => (
          <Card key={t.id} task={t} />
        ))}
      </div>
    </section>
  )
}
