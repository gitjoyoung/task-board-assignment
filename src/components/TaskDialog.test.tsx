import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskDialog } from './TaskDialog'
import type { Task } from '../types'

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '기존 제목',
    description: '기존 설명',
    status: 'todo',
    priority: 'high',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

describe('TaskDialog — 생성', () => {
  it('제목이 비어 있으면 저장 콜백이 호출되지 않는다', () => {
    const onSave = vi.fn()
    render(<TaskDialog open task={undefined} onClose={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('제목/우선순위/설명을 입력하고 저장하면 올바른 값으로 콜백이 호출된다', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<TaskDialog open onClose={onClose} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '새 태스크' } })
    fireEvent.change(screen.getByLabelText('우선순위'), { target: { value: 'low' } })
    fireEvent.change(screen.getByLabelText('설명'), { target: { value: '설명입니다' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(onSave).toHaveBeenCalledWith({
      title: '새 태스크',
      description: '설명입니다',
      priority: 'low',
    })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('TaskDialog — 수정', () => {
  it('기존 값으로 폼이 채워진다', () => {
    render(<TaskDialog open task={makeTask()} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByLabelText('제목')).toHaveValue('기존 제목')
    expect(screen.getByLabelText('설명')).toHaveValue('기존 설명')
    expect(screen.getByLabelText('우선순위')).toHaveValue('high')
  })

  it('삭제 버튼은 2단계 확인을 거친 뒤에만 삭제 콜백을 호출한다', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(
      <TaskDialog open task={makeTask()} onClose={onClose} onSave={vi.fn()} onDelete={onDelete} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onDelete).not.toHaveBeenCalled() // 1차 클릭: 확인 UI로 전환만
    expect(screen.getByText('정말 삭제할까요?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '삭제' })) // 2차 클릭: 확정
    expect(onDelete).toHaveBeenCalledWith('t1')
    expect(onClose).toHaveBeenCalled()
  })

  it('삭제 확인 중 취소를 누르면 삭제 콜백이 호출되지 않고 확인 UI가 닫힌다', () => {
    const onDelete = vi.fn()
    render(
      <TaskDialog open task={makeTask()} onClose={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByText('정말 삭제할까요?')).not.toBeInTheDocument()
  })
})
