'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react'

export type WorkerActivity = 'available' | 'unavailable' | 'offline'

const POLL_INTERVAL = 10_000 // 10 seconds

interface WorkerStatusContextType {
  status: WorkerActivity
  isLoading: boolean
  error: string | null
  isSessionExpired: boolean
  setStatus: (status: WorkerActivity) => Promise<void>
  refresh: () => Promise<void>
  reconnect: () => void
}

const WorkerStatusContext = createContext<WorkerStatusContextType | null>(null)

/**
 * Hook to access worker status - must be used within WorkerStatusProvider
 */
export function useWorkerStatus(): WorkerStatusContextType {
  const context = useContext(WorkerStatusContext)
  if (!context) {
    throw new Error('useWorkerStatus must be used within WorkerStatusProvider')
  }
  return context
}

interface WorkerStatusProviderProps {
  children: ReactNode
}

/**
 * Provider that manages worker status state via polling
 */
export function WorkerStatusProvider({ children }: WorkerStatusProviderProps) {
  const [status, setStatusState] = useState<WorkerActivity>('offline')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSessionExpired, setIsSessionExpired] = useState(false)
  const statusRef = useRef<WorkerActivity>('offline')
  const authFailedRef = useRef(false)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  /* ---------------------------------------------------- */
  /* Set worker offline (used when session expires)       */
  /* ---------------------------------------------------- */
  const setWorkerOffline = useCallback(() => {
    try {
      navigator.sendBeacon(
        '/api/taskrouter/worker-status',
        JSON.stringify({ status: 'offline' }),
      )
    } catch (error) {
      console.error('Failed to send offline beacon:', error)
    }
    setStatusState('offline')
    statusRef.current = 'offline'
  }, [])

  /* ---------------------------------------------------- */
  /* Handle session expiration                            */
  /* ---------------------------------------------------- */
  const handleSessionExpired = useCallback(() => {
    if (authFailedRef.current) return
    authFailedRef.current = true
    setIsSessionExpired(true)
    setError('Session expired - please log in again')
    setIsLoading(false)
    setWorkerOffline()

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [setWorkerOffline])

  /* ---------------------------------------------------- */
  /* Poll current status                                  */
  /* ---------------------------------------------------- */
  const refresh = useCallback(async () => {
    if (authFailedRef.current) return

    try {
      const res = await fetch('/api/taskrouter/worker-status')
      const data = await res.json()

      if (res.status === 401) {
        handleSessionExpired()
        return
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch status')
      }

      const newStatus = data.status || 'offline'
      if (newStatus !== statusRef.current) {
        setStatusState(newStatus)
        statusRef.current = newStatus
      }
      setError(null)
    } catch (err) {
      console.error('Failed to fetch worker status:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [handleSessionExpired])

  /* ---------------------------------------------------- */
  /* Update status                                        */
  /* ---------------------------------------------------- */
  const setStatus = useCallback(
    async (newStatus: WorkerActivity) => {
      if (authFailedRef.current) {
        throw new Error('Session expired - please log in again')
      }

      try {
        setIsLoading(true)
        setError(null)

        const res = await fetch('/api/taskrouter/worker-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        })
        const data = await res.json()

        if (res.status === 401) {
          handleSessionExpired()
          throw new Error('Session expired - please log in again')
        }

        if (!res.ok) {
          throw new Error(data.error || 'Failed to update status')
        }

        setStatusState(newStatus)
        statusRef.current = newStatus
      } catch (err) {
        console.error('Failed to update worker status:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    [handleSessionExpired],
  )

  /* ---------------------------------------------------- */
  /* Manual reconnect                                     */
  /* ---------------------------------------------------- */
  const reconnect = useCallback(() => {
    authFailedRef.current = false
    setIsSessionExpired(false)
    setError(null)
    setIsLoading(true)

    // Restart polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }
    refresh()
    pollIntervalRef.current = setInterval(refresh, POLL_INTERVAL)
  }, [refresh])

  /* ---------------------------------------------------- */
  /* Start polling on mount                               */
  /* ---------------------------------------------------- */
  useEffect(() => {
    refresh()
    pollIntervalRef.current = setInterval(refresh, POLL_INTERVAL)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [refresh])

  /* ---------------------------------------------------- */
  /* Auto-offline on tab close / refresh                  */
  /* ---------------------------------------------------- */
  useEffect(() => {
    const goOffline = () => {
      if (authFailedRef.current) return
      if (statusRef.current !== 'offline') {
        navigator.sendBeacon(
          '/api/taskrouter/worker-status',
          JSON.stringify({ status: 'offline' }),
        )
      }
    }

    window.addEventListener('beforeunload', goOffline)
    window.addEventListener('pagehide', goOffline)

    return () => {
      window.removeEventListener('beforeunload', goOffline)
      window.removeEventListener('pagehide', goOffline)
    }
  }, [])

  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    isSessionExpired,
    setStatus,
    refresh,
    reconnect,
  }

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  )
}
