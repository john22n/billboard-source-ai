'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import type { CurrentCall } from '@/lib/taskrouter-call-state'

export interface WorkerEntry {
  id: string
  name: string
  status: 'available' | 'ringing' | 'busy'
}

interface UseAvailableWorkersResult {
  workers: WorkerEntry[]
  currentCall: CurrentCall | null
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL = 2_000

async function requestWorkers(signal: AbortSignal) {
  const response = await fetch('/api/workers/available', {
    signal,
    cache: 'no-store',
  })
  if (response.status === 401) throw new Error('Unauthorized')

  if (!response.ok) {
    throw new Error('Failed to fetch available workers')
  }

  return (await response.json()) as {
    workers: WorkerEntry[]
    currentCall?: CurrentCall | null
  }
}

const AvailableWorkersContext = createContext<UseAvailableWorkersResult>({
  workers: [],
  currentCall: null,
  isLoading: true,
  error: null,
})

export function useAvailableWorkers() {
  return useContext(AvailableWorkersContext)
}

export function AvailableWorkersProvider({
  children,
}: {
  children: ReactNode
}) {
  const [workers, setWorkers] = useState<WorkerEntry[]>([])
  const [currentCall, setCurrentCall] = useState<CurrentCall | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authFailedRef = useRef(false)

  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const canPoll = () =>
      !disposed && !authFailedRef.current && !document.hidden

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
        if (disposed) return
        setWorkers(nextWorkers.workers)
        setCurrentCall(nextWorkers.currentCall ?? null)
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if ((err as Error).message === 'Unauthorized') {
          authFailedRef.current = true
          clearTimeoutIfScheduled()
          setWorkers([])
          setCurrentCall(null)
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
    window.addEventListener('online', handlePollingStateChange)
    window.addEventListener('focus', handlePollingStateChange)
    void fetchWorkers()

    return () => {
      disposed = true
      clearTimeoutIfScheduled()
      controller?.abort()
      document.removeEventListener('visibilitychange', handlePollingStateChange)
      window.removeEventListener('online', handlePollingStateChange)
      window.removeEventListener('focus', handlePollingStateChange)
    }
  }, [])

  return (
    <AvailableWorkersContext.Provider
      value={{ workers, currentCall, isLoading, error }}
    >
      {children}
    </AvailableWorkersContext.Provider>
  )
}
