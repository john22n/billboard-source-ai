'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { clearPersistedIssueReport } from '@/lib/issue-report-storage'

const SESSION_DURATION_MS = 10 * 60 * 60 * 1000

function getAutoLogoutCutoff(sessionIssuedAt: number) {
  const sessionStartedAt = new Date(sessionIssuedAt * 1000)
  return new Date(sessionStartedAt.getTime() + SESSION_DURATION_MS)
}

export function isAutoLogoutDue(sessionIssuedAt: number, now = new Date()) {
  const sessionCutoff = getAutoLogoutCutoff(sessionIssuedAt)
  return now >= sessionCutoff
}

/** Logs out after 10 hours unless a call still needs its Nutshell submission. */
export function useAutoLogout(sessionIssuedAt: number, logoutBlocked = false) {
  const router = useRouter()
  const hasLoggedOutRef = useRef(false)

  useEffect(() => {
    const setWorkerOffline = () => {
      clearPersistedIssueReport()
      navigator.sendBeacon(
        '/api/taskrouter/worker-status',
        JSON.stringify({ status: 'offline' }),
      )
    }

    window.addEventListener('pagehide', setWorkerOffline)

    return () => window.removeEventListener('pagehide', setWorkerOffline)
  }, [])

  const performLogout = useCallback(async () => {
    if (hasLoggedOutRef.current) return
    hasLoggedOutRef.current = true

    console.log('🔒 Session logout cutoff reached')

    try {
      const response = await fetch('/api/taskrouter/worker-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'offline' }),
      })
      if (!response.ok)
        throw new Error(`Worker status returned ${response.status}`)
      clearPersistedIssueReport()
      console.log('✅ Worker set to offline')
    } catch (error) {
      console.error('Failed to set worker offline:', error)
    }

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok)
        throw new Error(`Logout API returned ${response.status}`)

      clearPersistedIssueReport()
      router.replace('/login?reason=auto-logout')
    } catch (error) {
      hasLoggedOutRef.current = false
      console.error('Logout API call failed:', error)
    }
  }, [router])

  useEffect(() => {
    const sessionCutoff = getAutoLogoutCutoff(sessionIssuedAt)

    const now = new Date()

    const checkTime = () => {
      if (new Date() >= sessionCutoff && !logoutBlocked) void performLogout()
    }

    checkTime()
    const timeout = setTimeout(
      checkTime,
      Math.max(0, sessionCutoff.getTime() - now.getTime()),
    )

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkTime()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [logoutBlocked, performLogout, sessionIssuedAt])
}
