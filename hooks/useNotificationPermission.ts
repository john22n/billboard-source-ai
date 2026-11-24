'use client'

import { useState, useSyncExternalStore } from 'react'
import { supportsDesktopAlerts } from '@/lib/lead-notifications/desktop'

const permissionPromptKey = 'lead-alerts:permission-prompted'
const deniedGuidanceDismissedKey = 'lead-alerts:denied-guidance-dismissed'

type PermissionSnapshot = 'none' | 'prompt' | 'denied'

const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

const stateByPermission: Partial<
  Record<NotificationPermission, { key: string; snapshot: PermissionSnapshot }>
> = {
  default: { key: permissionPromptKey, snapshot: 'prompt' },
  denied: { key: deniedGuidanceDismissedKey, snapshot: 'denied' },
}

function readPermissionEntry() {
  if (!supportsDesktopAlerts()) return null
  return stateByPermission[Notification.permission] ?? null
}

function readPermissionSnapshot(): PermissionSnapshot {
  try {
    const entry = readPermissionEntry()
    if (!entry || localStorage.getItem(entry.key) === 'true') return 'none'
    return entry.snapshot
  } catch {
    return 'none'
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Preserve the permission refresh cadence without coupling it to inbox reads.
  const timer = setInterval(onChange, 15_000)
  window.addEventListener('storage', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('online', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    listeners.delete(onChange)
    clearInterval(timer)
    window.removeEventListener('storage', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('online', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

function persistFlag(key: string) {
  try {
    localStorage.setItem(key, 'true')
  } catch {
    // Storage restrictions must not prevent dismissing the current notice.
  }
  emitChange()
}

function shouldShowDeniedGuidance(
  snapshot: PermissionSnapshot,
  dismissed: boolean,
  hasActiveNotifications: boolean,
  justDenied: boolean,
) {
  return (
    !dismissed &&
    snapshot === 'denied' &&
    (hasActiveNotifications || justDenied)
  )
}

export function useNotificationPermission(hasActiveNotifications = false) {
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [guidanceDismissed, setGuidanceDismissed] = useState(false)
  const [justDenied, setJustDenied] = useState(false)
  const snapshot = useSyncExternalStore<PermissionSnapshot>(
    subscribe,
    readPermissionSnapshot,
    () => 'none',
  )

  function dismissPrompt() {
    setPromptDismissed(true)
    persistFlag(permissionPromptKey)
  }

  function dismissDeniedGuidance() {
    setGuidanceDismissed(true)
    persistFlag(deniedGuidanceDismissedKey)
  }

  async function requestPermission() {
    dismissPrompt()
    try {
      const result = await Notification.requestPermission()
      if (result === 'denied') setJustDenied(true)
    } catch {
      // Permission can be managed in browser settings; never repeatedly prompt.
    }
    emitChange()
  }

  return {
    shouldPrompt: !promptDismissed && snapshot === 'prompt',
    showDeniedGuidance: shouldShowDeniedGuidance(
      snapshot,
      guidanceDismissed,
      hasActiveNotifications,
      justDenied,
    ),
    requestPermission,
    dismissPrompt,
    dismissDeniedGuidance,
  }
}
