import type { Status } from '../types'
import { OFFLINE_MESSAGE, type FailedSummary } from '../lib/taskMover'

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
  /** 알림 메시지 — 실패 건이 있으면 건수 요약으로 대체하고, 오프라인 원인은 유지한다 */
  message: string
  /** 아직 해소되지 않은 실패 의도 목록 — 성공이 확정된 행은 개별로 빠진다 */
  items: FailedSummary[]
  onRetry: () => void
  onDiscard: () => void
}

/**
 * 실패 알림. 두 선택지(재시도/요청 취소)로 모든 실패가 명시적으로 해소된다.
 * 재시도를 눌러도 알림은 유지되고, 성공한 항목부터 목록에서 빠지며
 * 마지막 항목이 해소되어야 닫힌다. 비차단이라 결정을 미뤄도 작업엔 지장이 없다.
 */
export function FailureToast({ message, items, onRetry, onDiscard }: Props) {
  const count = items.length
  return (
    <div className="toast" role="alert">
      {/* 헤더: 실패 건은 건수 요약으로 통일(서버 오류 원문은 소음), 오프라인은 원인이라 유지 */}
      <span>
        {count > 0 && message !== OFFLINE_MESSAGE
          ? `변경 ${count}건이 저장되지 않았습니다.`
          : message}
      </span>
      {count > 0 && (
        <ul className="toast-items">
          {items.map((f) => (
            <li key={f.key}>{describe(f)}</li>
          ))}
        </ul>
      )}
      {count > 0 && (
        <>
          <button onClick={onRetry}>{count > 1 ? `${count}건 재시도` : '재시도'}</button>
          <button onClick={onDiscard}>요청 취소</button>
        </>
      )}
    </div>
  )
}
