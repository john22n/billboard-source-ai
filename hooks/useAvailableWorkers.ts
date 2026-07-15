'use client'

import { useState, useEffect, useRef } from 'react'

export interface WorkerEntry {
  id: string
  name: string
  status: 'available' | 'busy'
}

interface UseAvailableWorkersResult {
  workers: WorkerEntry[]
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL = 5_000 // 5 seconds

async function requestWorkers(signal: AbortSignal): Promise<WorkerEntry[]> {
  const response = await fetch('/api/workers/available', { signal })
  if (response.status === 401) throw new Error('Unauthorized')

  if (!response.ok) {
    throw new Error('Failed to fetch available workers')
  }

  const data = (await response.json()) as { workers: WorkerEntry[] }
  return data.workers
}

export function useAvailableWorkers(): UseAvailableWorkersResult {
  const [workers, setWorkers] = useState<WorkerEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authFailedRef = useRef(false)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const desktopQuery = window.matchMedia('(min-width: 640px)')

    const canPoll = () =>
      !disposed &&
      !authFailedRef.current &&
      !document.hidden &&
      desktopQuery.matches

    const clearTimeoutIfScheduled = () => {
      if (timeout) clearTimeout(timeout)
      timeout = null
    }

    const scheduleNextPoll = () => {
      clearTimeoutIfScheduled()
      if (canPoll()) timeout = setTimeout(fetchWorkers, POLL_INTERVAL)
    }

    const fetchWorkers = async () => {
      if (!canPoll() || controller) {
        setIsLoading(false)
        return
      }

      controller = new AbortController()
      try {
        const nextWorkers = await requestWorkers(controller.signal)
        setWorkers(nextWorkers)
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if ((err as Error).message === 'Unauthorized') {
          authFailedRef.current = true
          clearTimeoutIfScheduled()
          setWorkers([])
        }
        console.error('Failed to fetch available workers:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        controller = null
        setIsLoading(false)
        scheduleNextPoll()
      }
    }

    const handlePollingStateChange = () => {
      clearTimeoutIfScheduled()
      if (!canPoll()) {
        controller?.abort()
        return
      }
      void fetchWorkers()
    }

    document.addEventListener('visibilitychange', handlePollingStateChange)
    desktopQuery.addEventListener('change', handlePollingStateChange)
    void fetchWorkers()

    return () => {
      disposed = true
      clearTimeoutIfScheduled()
      controller?.abort()
      document.removeEventListener('visibilitychange', handlePollingStateChange)
      desktopQuery.removeEventListener('change', handlePollingStateChange)
    }
  }, [])

  return { workers, isLoading, error }
}
