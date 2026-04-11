'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AvailableWorker {
  sid: string
  displayName: string
}

interface UseAvailableWorkersResult {
  workers: AvailableWorker[]
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL = 30_000 // 30 seconds

export function useAvailableWorkers(): UseAvailableWorkersResult {
  const [workers, setWorkers] = useState<AvailableWorker[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authFailedRef = useRef(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchWorkers = useCallback(async () => {
    if (authFailedRef.current) return

    try {
      const res = await fetch('/api/workers/available')

      if (res.status === 401) {
        authFailedRef.current = true
        if (intervalRef.current) clearInterval(intervalRef.current)
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Failed to fetch available workers')
      }

      const data = await res.json() as { workers: AvailableWorker[] }
      setWorkers(data.workers ?? [])
      setError(null)
    } catch (err) {
      console.error('Failed to fetch available workers:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkers()
    intervalRef.current = setInterval(fetchWorkers, POLL_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchWorkers])

  return { workers, isLoading, error }
}
