import { useState } from 'react'
import { mockConfig } from '../mocks/config'
import { resetMockDb } from '../mocks/db'

/**
 * dev 전용: mock 서버 노브(실패율·지연)를 런타임으로 조정하는 패널.
 * App 에서 import.meta.env.DEV 일 때만 렌더된다 — 프로덕션 번들에는 UI 가 없다.
 */
/** navigator.onLine 을 오버라이드해 네트워크 단절을 시뮬레이션한다 (dev 전용 훅킹). */
function setSimulatedOffline(offline: boolean) {
  if (offline) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  } else {
    // own property 를 지우면 브라우저 원래 값으로 복원된다
    delete (navigator as { onLine?: boolean }).onLine
    window.dispatchEvent(new Event('online')) // 대기 큐 자동 재전송 트리거
  }
}

export function DevPanel() {
  const [, force] = useState(0)
  const [offline, setOffline] = useState(false)

  const bind = (key: keyof typeof mockConfig, step: number, max: number) => ({
    type: 'number' as const,
    step,
    min: 0,
    max,
    value: mockConfig[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      mockConfig[key] = Number(e.target.value)
      force((n) => n + 1)
    },
  })

  return (
    <details className="dev-panel">
      <summary>DEV 설정</summary>
      <label className="dev-panel-check">
        <input
          type="checkbox"
          checked={offline}
          onChange={(e) => {
            setOffline(e.target.checked)
            setSimulatedOffline(e.target.checked)
          }}
        />
        네트워크 끊김
      </label>
      <label>
        쓰기 실패율 (0~1)
        <input {...bind('WRITE_FAILURE_RATE', 0.05, 1)} />
      </label>
      <label>
        읽기 실패율 (0~1)
        <input {...bind('READ_FAILURE_RATE', 0.05, 1)} />
      </label>
      <label>
        지연 최소 (ms)
        <input {...bind('MIN_LATENCY', 50, 10000)} />
      </label>
      <label>
        지연 최대 (ms)
        <input {...bind('MAX_LATENCY', 50, 10000)} />
      </label>
      <button
        type="button"
        onClick={() => {
          resetMockDb()
          location.reload()
        }}
      >
        DB 초기 시드로 리셋
      </button>
    </details>
  )
}
