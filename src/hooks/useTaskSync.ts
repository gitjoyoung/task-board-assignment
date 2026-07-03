import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Task } from '../types'
import { createTask, deleteTask, updateTask } from '../api/client'
import { createTaskMover, type FailedSummary } from '../lib/taskMover'
import { TASKS_KEY } from './useTasksQuery'

/**
 * items 는 "아직 해소되지 않은" 실패 의도들이다. 실패가 확정될 때 항목이 쌓이고,
 * 각 항목은 성공이 확정되는 순간(onIntentSettled) 개별로 빠지며, 마지막 항목이
 * 해소되면 알림이 닫힌다. 재전송이 진행 중인 동안에는 행이 유지된다(출렁임 없음).
 */
export type SyncNotice = { message: string; failedCount: number; items: FailedSummary[] }

/** 기존 행 순서를 유지하며 큐의 최신 내용을 병합한다 (같은 key 는 갱신, 새 key 는 추가). */
function mergeItems(current: FailedSummary[], queue: FailedSummary[]): FailedSummary[] {
  const map = new Map(current.map((i) => [i.key, i]))
  for (const q of queue) map.set(q.key, q)
  return [...map.values()]
}

/** 다중 탭 방송 메시지. 서버가 확정한 변경만 실어 보낸다 (낙관 상태는 방송 금지). */
type SyncMessage = { type: 'upsert'; task: Task } | { type: 'remove'; id: string }

const CHANNEL_NAME = 'taskboard-sync'

/**
 * 동기화 정책(taskMover)을 Query 캐시에 배선하고 실패 알림 상태를 관리한다.
 * - 캐시가 단일 진실: mover 는 읽기/쓰기를 전부 이 캐시로만 한다
 * - 네트워크 복구(online) 시 실패 큐 자동 재전송
 */
export function useTaskSync() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<SyncNotice | null>(null)
  const noticeTimer = useRef<number>()

  // 다중 탭 동기화 채널. 생명주기는 아래 useEffect 가 소유한다 —
  // StrictMode 의 mount→cleanup→재mount 에서 닫힌 채널이 남지 않도록 ref 로만 참조.
  const channelRef = useRef<BroadcastChannel | null>(null)

  // onFailure 안에서 mover.getFailed() 를 불러야 하는데 mover 는 아직 생성 전이라 ref 로 우회
  const moverRef = useRef<ReturnType<typeof createTaskMover> | null>(null)

  const mover = useMemo(
    () =>
      createTaskMover({
        // 서버 확정분을 다른 탭들에 방송한다
        onCommitted: (task) =>
          channelRef.current?.postMessage({ type: 'upsert', task } as SyncMessage),
        onRemoved: (id) => channelRef.current?.postMessage({ type: 'remove', id } as SyncMessage),
        patchTask: updateTask,
        postTask: createTask,
        removeTask: deleteTask,
        readTask: (id) =>
          queryClient.getQueryData<Task[]>(TASKS_KEY)?.find((t) => t.id === id),
        writeTask: (task) =>
          queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) => {
            if (!prev) return prev
            const existing = prev.find((t) => t.id === task.id)
            if (!existing) return [task, ...prev]
            // 컬럼이 바뀐 카드는 배열 맨 앞으로 — 대상 컬럼 최상단에 보이게 한다.
            // 자기 배열 위치로 들어가면 가상화 창 밖(수백 번째 줄)에 떨어져
            // "이동이 반영 안 된 것처럼" 보이는 문제가 있었다.
            if (existing.status !== task.status)
              return [task, ...prev.filter((t) => t.id !== task.id)]
            return prev.map((t) => (t.id === task.id ? task : t))
          }),
        dropTask: (id) =>
          queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) =>
            prev?.filter((t) => t.id !== id),
          ),
        // 성공으로 해소된 의도는 알림 목록에서 개별로 빠지고, 마지막 행이 빠지면 알림을 닫는다
        onIntentSettled: (key, ok) => {
          if (!ok) return // 재실패는 onFailure 가 목록을 갱신한다
          setNotice((n) => {
            if (!n) return n
            const items = n.items.filter((i) => i.key !== key)
            if (items.length === n.items.length) return n
            return items.length === 0 ? null : { ...n, items }
          })
        },
        onFailure: (message, failedCount) => {
          setNotice((n) => ({
            message,
            failedCount,
            // 재전송 중인 행은 유지하고 큐의 최신 내용을 병합한다
            items: mergeItems(n?.items ?? [], moverRef.current?.getFailed() ?? []),
          }))
          window.clearTimeout(noticeTimer.current)
          // 재시도할 실패 건이 있으면 사용자가 처리할 때까지 알림을 유지한다
          if (failedCount === 0)
            noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
        },
      }),
    [queryClient],
  )
  moverRef.current = mover

  // 다른 탭이 방송한 서버 확정분을 수신해 캐시에 반영한다.
  // version 가드: 내 것보다 새로운 변경만 받아들인다 — 늦게 도착한 방송이나
  // 내가 진행 중인 낙관 상태를 낡은 값이 덮지 못하게 한다.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return // 미지원 환경에선 조용히 비활성
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel
    const onMessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data
      queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) => {
        if (!prev) return prev
        if (msg.type === 'remove') return prev.filter((t) => t.id !== msg.id)
        const existing = prev.find((t) => t.id === msg.task.id)
        if (!existing) return [msg.task, ...prev]
        if (existing.version >= msg.task.version) return prev
        // 발신 탭과 같은 표시 규칙: 컬럼이 바뀌면 맨 앞으로
        if (existing.status !== msg.task.status)
          return [msg.task, ...prev.filter((t) => t.id !== msg.task.id)]
        return prev.map((t) => (t.id === msg.task.id ? msg.task : t))
      })
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [queryClient])

  // 네트워크 복구 시 대기 중이던 실패 큐를 자동 재전송한다.
  // 알림은 닫지 않는다 — 재시도 버튼과 동일하게, 성공이 확정된 항목부터
  // 목록에서 빠지고 전부 해소되면 알림이 스스로 닫힌다. (닫고 재전송하는
  // 옛 방식은 실패분이 다시 뜰 때 알림이 깜빡이는 문제가 있었다)
  useEffect(() => {
    const onOnline = () => mover.retryFailed()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [mover])

  return { mover, notice, dismissNotice: () => setNotice(null) }
}
