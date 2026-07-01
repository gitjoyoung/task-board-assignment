import type { Task, Priority, Status } from '../types'
import { SEED_COUNT } from './config'

const PRIORITIES: Priority[] = ['high', 'medium', 'low']
const STATUSES: Status[] = ['todo', 'in-progress', 'done']
const TAG_POOL = ['frontend', 'backend', 'bug', 'feature', 'urgent', 'design', 'infra', 'docs']
const ASSIGNEES = ['김민준', '이서연', '박도윤', '최지우', '정하준', 'unassigned']
const VERBS = ['정리', '구현', '리뷰', '수정', '배포', '조사', '개선', '문서화']

// 결정적(deterministic) 난수 — 모든 지원자가 동일한 시드 데이터를 받습니다.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateSeedTasks(count: number = SEED_COUNT): Task[] {
  const rng = mulberry32(20260101)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]
  const base = Date.UTC(2026, 0, 1)

  const tasks: Task[] = []
  for (let i = 0; i < count; i++) {
    const created = new Date(base + Math.floor(rng() * 180) * 86_400_000).toISOString()
    const tagCount = Math.floor(rng() * 3)
    const tags = Array.from({ length: tagCount }, () => pick(TAG_POOL)).filter(
      (v, idx, a) => a.indexOf(v) === idx,
    )
    tasks.push({
      id: `seed-${i + 1}`,
      title: `Task #${i + 1} ${pick(VERBS)}`,
      description: rng() > 0.5 ? `자동 생성된 샘플 태스크 ${i + 1}` : undefined,
      status: pick(STATUSES),
      priority: pick(PRIORITIES),
      tags,
      assignee: pick(ASSIGNEES),
      createdAt: created,
      updatedAt: created,
      version: 1,
    })
  }
  return tasks
}
