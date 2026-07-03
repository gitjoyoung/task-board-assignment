import { useEffect, useRef, useState } from 'react'
import type { Priority, Task } from '../types'

export type TaskDialogInput = {
  title: string
  description?: string
  priority: Priority
}

interface Props {
  /** true 면 다이얼로그를 연다(showModal). false 면 닫는다(close). */
  open: boolean
  /** 있으면 수정 모드(기존 값으로 폼을 채움), 없으면 생성 모드. */
  task?: Task
  onClose: () => void
  onSave: (input: TaskDialogInput) => void
  /** 수정 모드에서만 사용. 2단계 확인 후 호출된다. */
  onDelete?: (id: string) => void
}

/**
 * 태스크 추가/수정 다이얼로그. 네이티브 <dialog> 요소를 사용한다(라이브러리·confirm/alert 금지).
 * 생성/수정 공용: task prop 유무로 모드를 구분한다.
 */
export function TaskDialog({ open, task, onClose, onSave, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // 열릴 때마다 폼을 현재 task(또는 빈 값)로 초기화하고 showModal/close 를 동기화한다.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      setTitle(task?.title ?? '')
      setDescription(task?.description ?? '')
      setPriority(task?.priority ?? 'medium')
      setConfirmingDelete(false)
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open, task])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return // 제목 필수
    onSave({ title: trimmed, description: description.trim() || undefined, priority })
    onClose()
  }

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (task) onDelete?.(task.id)
    onClose()
  }

  return (
    <dialog ref={dialogRef} className="task-dialog" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h3>{task ? '태스크 수정' : '새 태스크'}</h3>
        <label>
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          우선순위
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          설명
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="task-dialog-actions">
          {confirmingDelete ? (
            // 2단계 확인: 버튼 행 전체가 확인 UI로 바뀐다 (오조작 방지)
            <span className="confirm-delete">
              정말 삭제할까요?
              <button type="button" onClick={handleDeleteClick}>
                삭제
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                취소
              </button>
            </span>
          ) : (
            <>
              {task && (
                <button type="button" className="delete-btn" onClick={handleDeleteClick}>
                  삭제
                </button>
              )}
              <span className="spacer" />
              <button type="button" onClick={onClose}>
                취소
              </button>
              <button type="submit">저장</button>
            </>
          )}
        </div>
      </form>
    </dialog>
  )
}
