'use client'

import { useState, useSyncExternalStore } from 'react'
import { supportsDesktopAlerts } from '@/lib/lead-notifications/desktop'

const permissionPromptKey = 'lead-alerts:permission-prompted'

function shouldOfferPermission() {
  try {
    return (
      supportsDesktopAlerts() &&
      Notification.permission === 'default' &&
      localStorage.getItem(permissionPromptKey) !== 'true'
    )
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  // Preserve the permission refresh cadence without coupling it to inbox reads.
  const timer = setInterval(onChange, 15_000)
  window.addEventListener('storage', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('online', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    clearInterval(timer)
    window.removeEventListener('storage', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('online', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

export function useNotificationPermission() {
  const [dismissed, setDismissed] = useState(false)
  const shouldPrompt = useSyncExternalStore(
    subscribe,
    shouldOfferPermission,
    () => false,
  )

  function dismissPrompt() {
    setDismissed(true)
    try {
      localStorage.setItem(permissionPromptKey, 'true')
    } catch {
      // Storage restrictions must not prevent dismissing the current prompt.
    }
  }

  async function requestPermission() {
    dismissPrompt()
    try {
      await Notification.requestPermission()
    } catch {
      // Permission can be managed in browser settings; never repeatedly prompt.
    }
  }

  return {
    shouldPrompt: !dismissed && shouldPrompt,
    requestPermission,
    dismissPrompt,
  }
}
