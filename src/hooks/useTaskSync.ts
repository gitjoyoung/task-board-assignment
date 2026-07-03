import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Task } from '../types'
import { createTask, deleteTask, updateTask } from '../api/client'
import { createTaskMover } from '../lib/taskMover'
import { TASKS_KEY } from './useTasksQuery'

export type SyncNotice = { message: string; failedCount: number }

/**
 * 동기화 정책(taskMover)을 Query 캐시에 배선하고 실패 알림 상태를 관리한다.
 * - 캐시가 단일 진실: mover 는 읽기/쓰기를 전부 이 캐시로만 한다
 * - 네트워크 복구(online) 시 실패 큐 자동 재전송
 */
export function useTaskSync() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<SyncNotice | null>(null)
  const noticeTimer = useRef<number>()

  const mover = useMemo(
    () =>
      createTaskMover({
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
          setNotice({ message, failedCount })
          window.clearTimeout(noticeTimer.current)
          // 재시도할 실패 건이 있으면 사용자가 처리할 때까지 알림을 유지한다
          if (failedCount === 0)
            noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
        },
      }),
    [queryClient],
  )

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
