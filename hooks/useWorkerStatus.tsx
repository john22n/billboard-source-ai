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

interface WorkerStatusContextType {
  status: WorkerActivity
  isLoading: boolean
  error: string | null
  isSessionExpired: boolean
  updateStatus: (status: WorkerActivity) => Promise<void>
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
  }, [setWorkerOffline])

  /* ---------------------------------------------------- */
  /* Load current status                                  */
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
  const updateStatus = useCallback(
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

    void refresh()
  }, [refresh])

  /* ---------------------------------------------------- */
  /* A new dashboard session starts offline. The rep must */
  /* explicitly choose Available before receiving calls.  */
  /* ---------------------------------------------------- */
  useEffect(() => {
    // Establish the server-side status for each newly mounted dashboard session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void updateStatus('offline').catch(() => {
      // updateStatus exposes the error through context.
    })
  }, [updateStatus])

  const value: WorkerStatusContextType = {
    status,
    isLoading,
    error,
    isSessionExpired,
    updateStatus,
    refresh,
    reconnect,
  }

  return (
    <WorkerStatusContext.Provider value={value}>
      {children}
    </WorkerStatusContext.Provider>
  )
}
