'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LeadNotification {
  id: string
  companyName: string
  leadUrl: string
  leadCreatedAt: string
  createdAt: string
}

const urgencyLevels = [
  {
    label: 'Under 1 hour',
    colors: 'border-l-emerald-600 text-emerald-800 dark:text-emerald-300',
  },
  {
    label: '1–4 hours',
    colors: 'border-l-amber-500 text-amber-800 dark:text-amber-300',
  },
  {
    label: 'Over 4 hours',
    colors: 'border-l-red-600 text-red-800 dark:text-red-300',
  },
]

function elapsedTime(age: number) {
  const minutes = Math.floor(age / 60_000)
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

type DesktopState = 'unsupported' | 'default' | 'denied' | 'enabled'
type Connection = 'loading' | 'connected' | 'disconnected' | 'signed-out'

function supportsDesktopAlerts() {
  return 'Notification' in window && Boolean(navigator.locks)
}

function desktopState(preferenceKey: string): DesktopState {
  if (!supportsDesktopAlerts()) return 'unsupported'
  if (Notification.permission !== 'granted') return Notification.permission
  return localStorage.getItem(preferenceKey) === 'true' ? 'enabled' : 'default'
}

// Called under the account's Web Lock so only one tab claims each banner.
function claimDesktopAlert(userId: string, preferenceKey: string, id: string) {
  if (desktopState(preferenceKey) !== 'enabled') return false
  const key = `lead-alerts:${userId}:shown`
  const shown: string[] = JSON.parse(localStorage.getItem(key) || '[]')
  if (shown.includes(id)) return false
  localStorage.setItem(key, JSON.stringify([...shown.slice(-499), id]))
  return true
}

async function readInbox(userId: string, signal: AbortSignal) {
  const response = await fetch('/api/lead-notifications', {
    cache: 'no-store',
    signal,
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Unavailable')
  const data: {
    userId: string
    notifications: LeadNotification[]
    serverTime: string
  } = await response.json()
  return data.userId === userId ? data : null
}

function LeadNotificationItem({
  item,
  now,
  clearing,
  onClear,
}: {
  item: LeadNotification
  now: number
  clearing: string | null
  onClear: (item: LeadNotification) => void
}) {
  const age = Math.max(0, now - Date.parse(item.leadCreatedAt))
  const urgency = urgencyLevels[age < 3_600_000 ? 0 : age <= 14_400_000 ? 1 : 2]
  return (
    <li
      className={`rounded-xl border border-l-4 bg-card/85 p-3 shadow-md backdrop-blur-md ${urgency.colors}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium">
        <span className="flex items-center gap-1.5">
          <Bell className="size-3.5" aria-hidden="true" />
          {urgency.label}
        </span>
        <span className="tabular-nums">{elapsedTime(age)} elapsed</span>
      </div>
      <a
        href={item.leadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 rounded-sm text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <span className="break-words [overflow-wrap:anywhere]">
          {item.companyName}
        </span>
        <ExternalLink
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">Open in Nutshell (new tab)</span>
      </a>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Created{' '}
          <time dateTime={item.leadCreatedAt}>
            {new Date(item.leadCreatedAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`Clear ${item.companyName}`}
          disabled={clearing !== null}
          onClick={() => onClear(item)}
        >
          {clearing === item.id ? 'Clearing…' : 'Clear'}
        </Button>
      </div>
    </li>
  )
}

function useLeadNotifications(userId: string) {
  const [notifications, setNotifications] = useState<LeadNotification[]>([])
  const [connection, setConnection] = useState<Connection>('loading')
  const [now, setNow] = useState(0)
  const [clearing, setClearing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [desktop, setDesktop] = useState<DesktopState>('unsupported')
  const preferenceKey = `lead-alerts:${userId}:enabled`
  const cleared = useRef(new Set<string>())
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    let disposed = false
    let busy = false
    let offset = 0
    let hasSnapshot = false
    let lastSuccess = 0
    let known = new Set<string>()
    const banners = new Set<Notification>()
    const controller = new AbortController()
    const syncPermission = () => {
      try {
        setDesktop(desktopState(preferenceKey))
      } catch {
        setDesktop('unsupported')
      }
    }
    syncPermission()
    async function alertOnce(item: LeadNotification) {
      try {
        if (!supportsDesktopAlerts()) return
        await navigator.locks.request(`lead-alerts:${userId}`, () => {
          if (disposed || cleared.current.has(item.id)) return
          if (!claimDesktopAlert(userId, preferenceKey, item.id)) return
          const banner = new Notification(item.companyName, {
            body: 'New Contact Us lead assigned to you',
            tag: `lead:${userId}:${item.id}`,
          })
          banners.add(banner)
          banner.onclose = () => banners.delete(banner)
          banner.onclick = () => {
            window.open(item.leadUrl, '_blank', 'noopener,noreferrer')
            banner.close()
          }
        })
      } catch {
        // Browser/storage restrictions must never interrupt the in-app inbox.
      }
    }
    function acceptSnapshot(data: Awaited<ReturnType<typeof readInbox>>) {
      if (disposed) return
      if (data === null) {
        hasSnapshot = false
        for (const banner of banners) banner.close()
        setNotifications([])
        setConnection('signed-out')
        return
      }
      announceArrivals(data.notifications)
      offset = Date.parse(data.serverTime) - Date.now()
      setNow(Date.now() + offset)
      setNotifications(
        data.notifications.filter((item) => !cleared.current.has(item.id)),
      )
      setConnection('connected')
      syncPermission()
    }
    function announceArrivals(items: LeadNotification[]) {
      // First/recovery snapshots are silent, including after a suspended tab.
      const arrivals = items.filter((item) => !known.has(item.id))
      if (hasSnapshot && Date.now() - lastSuccess < 45_000) {
        arrivals.forEach((item) => {
          void alertOnce(item)
        })
      }
      known = new Set(items.map((item) => item.id))
      hasSnapshot = true
      lastSuccess = Date.now()
    }
    async function poll() {
      if (busy || disposed) return
      busy = true
      try {
        const data = await readInbox(
          userId,
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        )
        acceptSnapshot(data)
      } catch {
        offline()
      } finally {
        busy = false
      }
    }
    refresh.current = () => {
      void poll()
    }
    void poll()
    const polling = setInterval(() => {
      void poll()
    }, 15_000)
    const clock = setInterval(() => setNow(Date.now() + offset), 1_000)
    function offline() {
      hasSnapshot = false
      if (!disposed) setConnection('disconnected')
    }
    const resume = () => {
      void poll()
    }
    window.addEventListener('online', resume)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', resume)
    window.addEventListener('storage', syncPermission)
    document.addEventListener('visibilitychange', resume)
    return () => {
      disposed = true
      controller.abort()
      clearInterval(polling)
      clearInterval(clock)
      for (const banner of banners) banner.close()
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', resume)
      window.removeEventListener('storage', syncPermission)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [userId, preferenceKey])

  async function enableDesktop() {
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        localStorage.setItem(preferenceKey, 'true')
        setDesktop('enabled')
      } else setDesktop(permission === 'denied' ? 'denied' : 'default')
    } catch {
      setDesktop('unsupported')
    }
  }

  async function clear(item: LeadNotification) {
    setClearing(item.id)
    setError('')
    try {
      const response = await fetch(
        `/api/lead-notifications/${encodeURIComponent(item.id)}/clear`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!response.ok) throw new Error('Unavailable')
      cleared.current.add(item.id)
      setNotifications((current) => current.filter((n) => n.id !== item.id))
      refresh.current()
    } catch {
      setError(
        'Could not clear this lead. It is still in your inbox. Please try again.',
      )
    } finally {
      setClearing(null)
    }
  }

  return {
    notifications,
    connection,
    now,
    clearing,
    error,
    desktop,
    enableDesktop,
    clear,
  }
}

export function LeadNotifications({ userId }: { userId: string }) {
  const {
    notifications,
    connection,
    now,
    clearing,
    error,
    desktop,
    enableDesktop,
    clear,
  } = useLeadNotifications(userId)
  if (connection === 'signed-out') return null

  return (
    <section
      aria-label="Contact Us leads"
      className="pointer-events-none fixed right-3 top-16 z-40 w-[calc(100%-1.5rem)] max-w-xs sm:right-4"
    >
      <div className="pointer-events-auto max-h-[calc(100dvh-9rem)] space-y-2 overflow-y-auto rounded-2xl">
        <InboxStatus connection={connection} />
        {error && (
          <p
            role="alert"
            className="rounded-xl border bg-card p-3 text-sm text-destructive shadow-lg"
          >
            {error}
          </p>
        )}
        <LeadNotificationList
          notifications={notifications}
          now={now}
          clearing={clearing}
          onClear={clear}
        />
      </div>
      <details className="pointer-events-auto mt-2 ml-auto w-fit max-w-full rounded-xl bg-card/85 text-xs text-muted-foreground shadow-sm backdrop-blur-md">
        <summary className="cursor-pointer px-3 py-2">Desktop alerts</summary>
        <div className="space-y-2 px-3 pb-3">
          <DesktopPermission desktop={desktop} enableDesktop={enableDesktop} />
          <p>
            Keep the app open. Chrome and your operating system control desktop
            banner duration.
          </p>
        </div>
      </details>
    </section>
  )
}

function InboxStatus({ connection }: { connection: Connection }) {
  if (connection === 'disconnected')
    return (
      <div
        role="status"
        className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      >
        Updates unavailable. This list may be out of date. We’ll retry
        automatically.
      </div>
    )
  return null
}

function LeadNotificationList({
  notifications,
  now,
  clearing,
  onClear,
}: {
  notifications: LeadNotification[]
  now: number
  clearing: string | null
  onClear: (item: LeadNotification) => void
}) {
  if (notifications.length === 0) return null
  return (
    <ul className="space-y-2" aria-label="Active lead notifications">
      {notifications.map((item) => (
        <LeadNotificationItem
          key={item.id}
          item={item}
          now={now}
          clearing={clearing}
          onClear={onClear}
        />
      ))}
    </ul>
  )
}

function DesktopPermission({
  desktop,
  enableDesktop,
}: {
  desktop: DesktopState
  enableDesktop: () => Promise<void>
}) {
  const messages = {
    enabled: 'Desktop alerts enabled in this browser.',
    denied:
      'Desktop alerts are blocked. In Chrome, open this site’s settings → Notifications → Allow. Your in-app leads still appear here.',
    unsupported:
      'Desktop alerts are unavailable in this browser. Your in-app leads still appear here.',
  }
  if (desktop !== 'default') return <p>{messages[desktop]}</p>
  return (
    <Button variant="outline" size="sm" onClick={() => void enableDesktop()}>
      <Bell aria-hidden="true" />
      Enable desktop alerts
    </Button>
  )
}
