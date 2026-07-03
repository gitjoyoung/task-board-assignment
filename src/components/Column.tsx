import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Task, Status } from '../types'
import { Card } from './Card'

interface Props {
  title: string
  status: Status
  tasks: Task[]
  onMove: (id: string, status: Status) => void
  onAdd: (status: Status) => void
  onEdit: (task: Task) => void
}

/** 카드 높이(테두리·패딩 포함) + 카드 간격 8px. 제목은 한 줄 말줄임이라 높이가 일정하다. */
const ROW_HEIGHT = 75

export function Column({ title, status, tasks, onMove, onAdd, onEdit }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // ponytail: 고정 높이 가상화 — 카드가 여러 줄(설명 표시 등)이 되면 measureElement 실측으로 전환
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (i) => tasks[i].id,
  })

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
        <button
          type="button"
          className="add-btn"
          aria-label={`${title}에 태스크 추가`}
          onClick={() => onAdd(status)}
        >
          +
        </button>
      </h2>
      <div className="column-body" ref={bodyRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <Card task={tasks[vi.index]} onClick={() => onEdit(tasks[vi.index])} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
