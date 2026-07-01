export type Status = 'todo' | 'in-progress' | 'done'
export type Priority = 'high' | 'medium' | 'low'

export interface Task {
  id: string
  title: string
  description?: string
  status: Status
  priority: Priority
  tags?: string[]
  assignee?: string
  createdAt: string // ISO
  updatedAt: string // ISO
  /** 낙관적 동시성 제어용. PATCH 시 이 값을 함께 보내야 하며, 서버 값과 다르면 409. */
  version: number
}
