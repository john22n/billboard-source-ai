'use client'

import { useEffect } from 'react'
import { useMockupStore } from '@/stores/mockupStore'

export function useMockupSession() {
  useEffect(() => {
    let disposed = false
    const check = async () => {
      try {
        const response = await fetch('/api/mockup/session', {
          cache: 'no-store',
        })
        if (disposed) return
        if (response.status === 401) {
          useMockupStore.getState().clear()
          return
        }
        if (!response.ok) return
        const session = await response.json()
        if (!disposed) useMockupStore.getState().initialize(session.key)
      } catch {
        /* A temporary network outage is not logout. */
      }
    }
    void check()
    const interval = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('billboard-mockup-logout')
        : null
    if (channel) channel.onmessage = () => useMockupStore.getState().clear()
    return () => {
      disposed = true
      clearInterval(interval)
      window.removeEventListener('focus', check)
      channel?.close()
    }
  }, [])
}
