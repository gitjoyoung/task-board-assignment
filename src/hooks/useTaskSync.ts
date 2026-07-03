import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Task } from '../types'
import { createTask, deleteTask, updateTask } from '../api/client'
import { createTaskMover, type FailedSummary } from '../lib/taskMover'
import { TASKS_KEY } from './useTasksQuery'

/**
 * items 는 알림 시점의 실패 목록 스냅샷이다. 라이브로 큐를 읽으면 실패 카드를
 * 다시 옮기는 동안(재전송 중) 행이 사라졌다 실패 시 다시 나타나는 출렁임이 생긴다.
 */
export type SyncNotice = { message: string; failedCount: number; items: FailedSummary[] }

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
            const exists = prev.some((t) => t.id === task.id)
            return exists ? prev.map((t) => (t.id === task.id ? task : t)) : [task, ...prev]
          }),
        dropTask: (id) =>
          queryClient.setQueryData<Task[]>(TASKS_KEY, (prev) =>
            prev?.filter((t) => t.id !== id),
          ),
        onFailure: (message, failedCount) => {
          setNotice({ message, failedCount, items: moverRef.current?.getFailed() ?? [] })
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
        return existing.version >= msg.task.version
          ? prev
          : prev.map((t) => (t.id === msg.task.id ? msg.task : t))
      })
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [queryClient])

  // 네트워크 복구 시 대기 중이던 실패 큐를 자동 재전송한다.
  // 알림도 함께 닫는다 — 재전송이 또 실패하면 onFailure 가 다시 띄운다.
  useEffect(() => {
    const onOnline = () => {
      mover.retryFailed()
      setNotice(null)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [mover])

  return { mover, notice, dismissNotice: () => setNotice(null) }
}
