import { useQuery } from '@tanstack/react-query'
import { getTasks } from '../api/client'

/**
 * 태스크 목록의 단일 진실(SoT)은 이 키의 Query 캐시 하나다.
 * 읽기는 이 훅으로, 쓰기는 useTaskSync(뮤테이션 응답으로 캐시 직접 갱신)로만 한다.
 */
export const TASKS_KEY = ['tasks'] as const

export function useTasksQuery() {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: ({ signal }) => getTasks(signal),
  })
}
