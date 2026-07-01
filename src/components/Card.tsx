import type { Task } from '../types'

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function Card({ task }: { task: Task }) {
  return (
    <article
      className={`card priority-${task.priority}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
    >
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        <span className={`badge badge-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        <span className="date">{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
    </article>
  )
}
