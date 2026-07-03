import { http, HttpResponse, delay } from 'msw'
import type { Task } from '../types'
import { getStore, setStore } from './db'
import { mockConfig } from './config'

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

async function latency() {
  await delay(randInt(mockConfig.MIN_LATENCY, mockConfig.MAX_LATENCY))
}

const serverError = () =>
  HttpResponse.json({ message: '일시적인 서버 오류입니다. 다시 시도해 주세요.' }, { status: 500 })

export const handlers = [
  // 전체 조회 — 5,000개를 한 번에 반환합니다.
  // '*/api/...' 와일드카드: base 서브경로(/repo/api/...) 배포도 함께 매칭됩니다.
  http.get('*/api/tasks', async () => {
    await latency()
    if (Math.random() < mockConfig.READ_FAILURE_RATE) return serverError()
    return HttpResponse.json(getStore())
  }),

  // 생성
  http.post('*/api/tasks', async ({ request }) => {
    await latency()
    if (Math.random() < mockConfig.WRITE_FAILURE_RATE) return serverError()

    const body = (await request.json()) as Partial<Task>
    const now = new Date().toISOString()
    const task: Task = {
      id: crypto.randomUUID(),
      title: body.title ?? 'Untitled',
      description: body.description,
      status: body.status ?? 'todo',
      priority: body.priority ?? 'medium',
      tags: body.tags ?? [],
      assignee: body.assignee,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    setStore([task, ...getStore()])
    return HttpResponse.json(task, { status: 201 })
  }),

  // 부분 수정 (낙관적 동시성 제어)
  http.patch('*/api/tasks/:id', async ({ request, params }) => {
    await latency()
    if (Math.random() < mockConfig.WRITE_FAILURE_RATE) return serverError()

    const id = params.id as string
    const body = (await request.json()) as Partial<Task> & { version?: number }
    const store = getStore()
    const idx = store.findIndex((t) => t.id === id)
    if (idx === -1) {
      return HttpResponse.json({ message: '태스크를 찾을 수 없습니다.' }, { status: 404 })
    }

    const current = store[idx]
    // version 이 넘어왔는데 서버 값과 다르면 409 + 서버 최신 상태 반환
    if (typeof body.version === 'number' && body.version !== current.version) {
      return HttpResponse.json(
        { message: '다른 곳에서 먼저 수정되었습니다.', current },
        { status: 409 },
      )
    }

    const updated: Task = {
      ...current,
      ...body,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    }
    const next = store.slice()
    next[idx] = updated
    setStore(next)
    return HttpResponse.json(updated)
  }),

  // 삭제
  http.delete('*/api/tasks/:id', async ({ params }) => {
    await latency()
    if (Math.random() < mockConfig.WRITE_FAILURE_RATE) return serverError()

    const id = params.id as string
    setStore(getStore().filter((t) => t.id !== id))
    return new HttpResponse(null, { status: 204 })
  }),
]
