'use client'

import { useState, useEffect, useRef } from 'react'

interface UseAvailableWorkersResult {
  count: number
  names: string[]
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL = 30_000 // 30 seconds

export function useAvailableWorkers(): UseAvailableWorkersResult {
  const [count, setCount] = useState(0)
  const [names, setNames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authFailedRef = useRef(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const fetchWorkers = async () => {
      if (authFailedRef.current) {
        setIsLoading(false)
        return
      }

      try {
        const res = await fetch('/api/workers/available', { signal: controller.signal })

        if (res.status === 401) {
          authFailedRef.current = true
          if (intervalRef.current) clearInterval(intervalRef.current)
          setIsLoading(false)
          return
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as { error?: string }).error ?? 'Failed to fetch available workers')
        }

        const data = (await res.json()) as { count: number; names: string[] }
        setCount(data.count ?? 0)
        setNames(data.names ?? [])
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        console.error('Failed to fetch available workers:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkers()
    intervalRef.current = setInterval(fetchWorkers, POLL_INTERVAL)

    return () => {
      controller.abort()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return { count, names, isLoading, error }
}
