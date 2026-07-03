import { useEffect, useState } from 'react'

// 값이 delayMs 동안 더 바뀌지 않을 때만 반영한다 (검색어 디바운스용).
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
