import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FailureToast } from './FailureToast'

describe('FailureToast', () => {
  it('다건 실패는 건수 요약과 항목별 상세(어디서 어디로, 어떤 필드)를 보여준다', () => {
    render(
      <FailureToast
        message="일시적인 서버 오류입니다. 다시 시도해 주세요."
        items={[
          { key: 'a', kind: 'move', label: '카드 A', from: 'todo', to: 'done' },
          { key: 'b', kind: 'update', label: '카드 B', fields: ['title', 'priority'] },
          { key: 'c', kind: 'create', label: '카드 C', status: 'in-progress' },
        ]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('변경 3건이 저장되지 않았습니다.')
    expect(screen.getByText('이동: “카드 A” — To Do → Done')).toBeInTheDocument()
    expect(screen.getByText('수정: “카드 B” — 제목·우선순위 변경')).toBeInTheDocument()
    expect(screen.getByText('생성: “카드 C” → In Progress')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3건 재시도' })).toBeInTheDocument()
  })

  it('단건 실패도 서버 오류 원문 대신 건수 요약을 보여준다', () => {
    render(
      <FailureToast
        message="일시적인 서버 오류입니다. 다시 시도해 주세요."
        items={[{ key: 'a', kind: 'move', label: '카드 A', from: 'todo', to: 'done' }]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('변경 1건이 저장되지 않았습니다.')
    expect(screen.queryByText(/일시적인 서버 오류/)).not.toBeInTheDocument()
  })

  it('오프라인 실패는 원인(연결 확인)을 헤더로 유지한다', () => {
    render(
      <FailureToast
        message="네트워크 연결을 확인해주세요."
        items={[{ key: 'a', kind: 'move', label: '카드 A', from: 'todo', to: 'done' }]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('네트워크 연결을 확인해주세요.')
  })

  it('재시도/요청 취소가 각각 콜백을 호출한다', () => {
    const onRetry = vi.fn()
    const onDiscard = vi.fn()
    render(
      <FailureToast
        message="오류"
        items={[{ key: 'c', kind: 'remove', label: '카드 C', status: 'done' }]}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '재시도' }))
    fireEvent.click(screen.getByRole('button', { name: '요청 취소' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('재시도 진행 중에는 버튼이 잠기고 진행 표시를 보여준다', () => {
    render(
      <FailureToast
        message="오류"
        items={[{ key: 'a', kind: 'move', label: '카드 A', from: 'todo', to: 'done' }]}
        retrying
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    const retryBtn = screen.getByRole('button', { name: /재시도 중/ })
    expect(retryBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: '요청 취소' })).toBeDisabled()
  })

  it('해소할 항목이 없으면(정보성 알림) 버튼 없이 메시지만 보여준다', () => {
    render(
      <FailureToast
        message="다른 곳에서 먼저 수정되었습니다."
        items={[]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('다른 곳에서 먼저 수정되었습니다.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
