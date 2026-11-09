'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

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
      className={`rounded-lg border border-l-4 bg-card p-4 ${urgency.colors}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold">
        <span>{urgency.label}</span>
        <span className="tabular-nums">{elapsedTime(age)} elapsed</span>
      </div>
      <a
        href={item.leadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 rounded-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <span className="break-words [overflow-wrap:anywhere]">
          {item.companyName}
        </span>
        <ExternalLink
          className="mt-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">Open in Nutshell (new tab)</span>
      </a>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Created
          <br />
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
    <div className="flex h-11 shrink-0 items-center justify-between border-b bg-background px-4 text-sm">
      <span className="text-muted-foreground">
        Contact Us <span className="hidden sm:inline">· Assigned to you</span>
      </span>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Lead notifications, ${notifications.length} active`}
          >
            <Bell aria-hidden="true" />
            <span>Leads</span>
            <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs text-primary-foreground">
              {notifications.length}
            </span>
            {connection === 'disconnected' && (
              <span className="text-amber-700 dark:text-amber-400">
                Offline
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="border-b px-6 pb-5 pt-7">
            <SheetTitle className="text-xl">Contact Us leads</SheetTitle>
            <SheetDescription>
              Assigned to you. Oldest first. Leads stay here until you select
              Clear—even after signing out.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <InboxStatus connection={connection} />
            {error && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {error}
              </p>
            )}
            <LeadNotificationList
              connection={connection}
              notifications={notifications}
              now={now}
              clearing={clearing}
              onClear={clear}
            />
          </div>
          <div className="space-y-3 border-t px-6 py-4 text-xs text-muted-foreground">
            <DesktopPermission
              desktop={desktop}
              enableDesktop={enableDesktop}
            />
            <p>
              Keep the app open for desktop alerts. Chrome and your operating
              system control banner duration.
            </p>
            <p>
              Elapsed time includes nights and weekends. Clear acknowledges the
              notification; it does not update Nutshell.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function InboxStatus({ connection }: { connection: Connection }) {
  if (connection === 'loading')
    return (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        Loading your leads…
      </p>
    )
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
  connection,
  notifications,
  now,
  clearing,
  onClear,
}: {
  connection: Connection
  notifications: LeadNotification[]
  now: number
  clearing: string | null
  onClear: (item: LeadNotification) => void
}) {
  if (connection === 'connected' && notifications.length === 0)
    return (
      <div className="py-14 text-center">
        <CheckCheck
          className="mx-auto mb-3 size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="font-medium">You’re all caught up</p>
        <p className="mt-1 text-sm text-muted-foreground">
          New Contact Us assignments will appear here.
        </p>
      </div>
    )
  return (
    <ul className="space-y-3" aria-label="Active lead notifications">
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
