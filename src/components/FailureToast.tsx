import type { Status } from '../types'
import type { FailedSummary } from '../lib/taskMover'
import type { SyncNotice } from '../hooks/useTaskSync'

const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
}

const FIELD_LABEL: Record<string, string> = {
  title: '제목',
  description: '설명',
  priority: '우선순위',
  status: '상태',
}

/** 실패 의도 한 건을 "무엇을 하다 실패했는지"가 보이게 서술한다. */
function describe(f: FailedSummary): string {
  switch (f.kind) {
    case 'move':
      return `이동: “${f.label}” — ${STATUS_LABEL[f.from]} → ${STATUS_LABEL[f.to]}`
    case 'update':
      return `수정: “${f.label}” — ${f.fields.map((k) => FIELD_LABEL[k] ?? k).join('·')} 변경`
    case 'create':
      return `생성: “${f.label}” → ${STATUS_LABEL[f.status]}`
    case 'remove':
      return `삭제: “${f.label}” (${STATUS_LABEL[f.status]})`
  }
}

interface Props {
  notice: SyncNotice
  /** 재시도 대기 중인 실패 의도 목록 (렌더 시점 기준) */
  items: FailedSummary[]
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
            <li key={i}>{describe(f)}</li>
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
