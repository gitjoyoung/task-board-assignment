import type { SyncNotice } from '../hooks/useTaskSync'

export type FailedItem = { kind: 'move' | 'update' | 'create' | 'remove'; label: string }

const KIND_LABEL: Record<FailedItem['kind'], string> = {
  move: '이동',
  update: '수정',
  create: '생성',
  remove: '삭제',
}

interface Props {
  notice: SyncNotice
  /** 재시도 대기 중인 실패 의도 목록 (렌더 시점 기준) */
  items: FailedItem[]
  onRetry: () => void
  onDiscard: () => void
}

/**
 * 실패 알림. 두 선택지(재시도/요청 취소)로 모든 실패가 명시적으로 해소된다
 * (숨김 상태의 유령 큐 없음). 비차단이라 결정을 미뤄도 작업엔 지장이 없다.
 */
export function FailureToast({ notice, items, onRetry, onDiscard }: Props) {
  return (
    <div className="toast" role="alert">
      <span>
        {notice.failedCount > 1
          ? `변경 ${notice.failedCount}건이 저장되지 않았습니다.`
          : notice.message}
      </span>
      {items.length > 0 && (
        <ul className="toast-items">
          {items.map((f, i) => (
            <li key={i}>
              {KIND_LABEL[f.kind]}: &ldquo;{f.label}&rdquo;
            </li>
          ))}
        </ul>
      )}
      {notice.failedCount > 0 && (
        <>
          <button onClick={onRetry}>
            {notice.failedCount > 1 ? `${notice.failedCount}건 재시도` : '재시도'}
          </button>
          <button onClick={onDiscard}>요청 취소</button>
        </>
      )}
    </div>
  )
}
