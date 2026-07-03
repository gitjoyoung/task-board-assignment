import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delay 가 지나기 전까지는 중간 값이 반영되지 않는다', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ value: 'abc' })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // 연속 변경 중이라 아직 최초 값 그대로여야 한다
    expect(result.current).toBe('a')
  })

  it('마지막 변경 후 delay 만큼 지나면 최종 값이 반영된다', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(result.current).toBe('ab')
  })
})
