import type { Task } from '../types'

// base 경로 하위로 요청해야 GitHub Pages 서브경로 배포 시에도
// MSW 서비스워커(scope=base) 가 요청을 가로챌 수 있습니다.
const BASE = `${import.meta.env.BASE_URL}api`

/** 서버 오류를 담아 던지는 에러. status/payload 로 409 충돌 시 서버 최신 상태에 접근할 수 있습니다. */
export class ApiError extends Error {
  status: number
  payload: unknown
  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      /* body 없음 */
    }
    const message =
      (payload as { message?: string } | null)?.message ?? `요청 실패 (${res.status})`
    throw new ApiError(res.status, message, payload)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function getTasks(signal?: AbortSignal): Promise<Task[]> {
  return fetch(`${BASE}/tasks`, { signal }).then((r) => handle<Task[]>(r))
}

export function createTask(input: Partial<Task>): Promise<Task> {
  return fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => handle<Task>(r))
}

export function updateTask(
  id: string,
  patch: Partial<Task> & { version: number },
): Promise<Task> {
  return fetch(`${BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => handle<Task>(r))
}

export function deleteTask(id: string): Promise<void> {
  return fetch(`${BASE}/tasks/${id}`, { method: 'DELETE' }).then((r) => handle<void>(r))
}
