'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const LOGOUT_HOUR = 19
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000

function getAutoLogoutCutoff(sessionIssuedAt: number) {
  const sessionStartedAt = new Date(sessionIssuedAt * 1000)
  const sessionExpiration = new Date(
    sessionStartedAt.getTime() + SESSION_DURATION_MS,
  )
  const dailyCutoff = new Date(sessionStartedAt)
  dailyCutoff.setHours(LOGOUT_HOUR, 0, 0, 0)

  return sessionStartedAt < dailyCutoff && dailyCutoff < sessionExpiration
    ? dailyCutoff
    : sessionExpiration
}

export function isAutoLogoutDue(sessionIssuedAt: number, now = new Date()) {
  const sessionCutoff = getAutoLogoutCutoff(sessionIssuedAt)
  return now >= sessionCutoff
}

/** Logs out at the earlier of 7 PM or eight hours after login. */
export function useAutoLogout(sessionIssuedAt: number, isCallActive = false) {
  const router = useRouter()
  const hasLoggedOutRef = useRef(false)

  useEffect(() => {
    const setWorkerOffline = () => {
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
      console.log('✅ Worker set to offline')
    } catch (error) {
      console.error('Failed to set worker offline:', error)
    }

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok)
        throw new Error(`Logout API returned ${response.status}`)

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
      if (new Date() >= sessionCutoff && !isCallActive) void performLogout()
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
  }, [isCallActive, performLogout, sessionIssuedAt])
}
