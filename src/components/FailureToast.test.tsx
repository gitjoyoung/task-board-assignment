import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FailureToast } from './FailureToast'

describe('FailureToast', () => {
  it('다건 실패는 건수 요약과 항목별 내역(종류: 제목)을 보여준다', () => {
    render(
      <FailureToast
        notice={{ message: '일시적인 서버 오류입니다.', failedCount: 2 }}
        items={[
          { kind: 'move', label: '카드 A' },
          { kind: 'create', label: '카드 B' },
        ]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('변경 2건이 저장되지 않았습니다.')
    expect(screen.getByText(/이동: “카드 A”/)).toBeInTheDocument()
    expect(screen.getByText(/생성: “카드 B”/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2건 재시도' })).toBeInTheDocument()
  })

  it('재시도/요청 취소가 각각 콜백을 호출한다', () => {
    const onRetry = vi.fn()
    const onDiscard = vi.fn()
    render(
      <FailureToast
        notice={{ message: '오류', failedCount: 1 }}
        items={[{ kind: 'remove', label: '카드 C' }]}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '재시도' }))
    fireEvent.click(screen.getByRole('button', { name: '요청 취소' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('실패 건수 0(정보성 알림)이면 버튼 없이 메시지만 보여준다', () => {
    render(
      <FailureToast
        notice={{ message: '다른 곳에서 먼저 수정되었습니다.', failedCount: 0 }}
        items={[]}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('다른 곳에서 먼저 수정되었습니다.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
