'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  createLeadInboxClient,
  type InboxConnection,
  type LeadInboxClient,
  type LeadNotification,
} from '@/lib/lead-notifications/inbox-client'
import { useNotificationPermission } from '@/hooks/useNotificationPermission'

const urgencyLevels = [
  {
    label: 'Under 1 hour',
    card: 'border-emerald-800/50 bg-emerald-700/70 text-white dark:border-emerald-400/40 dark:bg-emerald-700/70',
    muted: 'text-white/95',
    clearButton:
      'border-white/45 bg-black/20 text-white hover:bg-black/30 hover:text-white',
  },
  {
    label: '1–4 hours',
    card: 'border-amber-600/60 bg-amber-500/70 text-amber-950 dark:border-amber-400/50 dark:bg-amber-500/70',
    muted: 'text-amber-950/90',
    clearButton:
      'border-amber-950/35 bg-amber-950/10 text-amber-950 hover:bg-amber-950/20 hover:text-amber-950',
  },
  {
    label: 'Over 4 hours',
    card: 'border-red-800/50 bg-red-700/70 text-white dark:border-red-400/40 dark:bg-red-700/70',
    muted: 'text-white/95',
    clearButton:
      'border-white/45 bg-black/20 text-white hover:bg-black/30 hover:text-white',
  },
]

function elapsedTime(age: number) {
  const minutes = Math.floor(age / 60_000)
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
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
      className={`rounded-xl border p-3 shadow-md backdrop-blur-sm ${urgency.card}`}
    >
      <div
        className={`mb-1.5 flex items-center justify-between gap-2 text-xs font-medium ${urgency.muted}`}
      >
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
        className="flex items-start justify-between gap-3 rounded-sm text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
      >
        <span className="break-words [overflow-wrap:anywhere]">
          {item.companyName}
        </span>
        <ExternalLink
          className={`mt-0.5 size-3.5 shrink-0 ${urgency.muted}`}
          aria-hidden="true"
        />
        <span className="sr-only">Open in Nutshell (new tab)</span>
      </a>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className={`text-xs ${urgency.muted}`}>
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
          className={`h-7 px-2 text-xs ${urgency.clearButton}`}
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
  const [connection, setConnection] = useState<InboxConnection>('loading')
  const [now, setNow] = useState(0)
  const [clearing, setClearing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const offsetRef = useRef(0)
  const clientRef = useRef<LeadInboxClient | null>(null)

  useEffect(() => {
    const localOptIn =
      process.env.NODE_ENV === 'development' &&
      new URLSearchParams(window.location.search).get('leadSsePrototype') ===
        'true'
    const client = createLeadInboxClient({
      userId,
      localOptIn,
      onStateChange(next) {
        offsetRef.current = next.serverOffset
        setNow(Date.now() + next.serverOffset)
        setNotifications(next.notifications)
        setConnection(next.connection)
      },
    })
    clientRef.current = client
    const clock = setInterval(
      () => setNow(Date.now() + offsetRef.current),
      1_000,
    )
    return () => {
      clearInterval(clock)
      client.dispose()
      if (clientRef.current === client) clientRef.current = null
    }
  }, [userId])

  async function clear(item: LeadNotification) {
    if (!clientRef.current) return
    setClearing(item.id)
    setError('')
    try {
      const ok = await clientRef.current.clear(item.id)
      if (!ok) {
        setError(
          'Could not clear this notification. It is still in your inbox. Please try again.',
        )
      }
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
    clear,
  }
}

export function LeadNotifications({ userId }: { userId: string }) {
  const { notifications, connection, now, clearing, error, clear } =
    useLeadNotifications(userId)
  const {
    shouldPrompt,
    showDeniedGuidance,
    requestPermission,
    dismissPrompt,
    dismissDeniedGuidance,
  } = useNotificationPermission(notifications.length > 0)
  if (connection === 'signed-out') return null

  const connected = connection === 'connected'

  return (
    <section
      aria-label="Web leads"
      className="pointer-events-none fixed right-3 top-16 z-40 w-[calc(100%-1.5rem)] max-w-xs sm:right-4"
    >
      <div className="pointer-events-auto max-h-[calc(100dvh-9rem)] space-y-2 overflow-y-auto rounded-2xl">
        <InboxStatus connection={connection} error={error} />
        <LeadNotificationList
          notifications={notifications}
          now={now}
          clearing={clearing}
          onClear={clear}
        />
        <DeniedPermissionGuidance
          visible={showDeniedGuidance && connected}
          onDismiss={dismissDeniedGuidance}
        />
      </div>
      <PermissionPromptDialog
        open={shouldPrompt && connected}
        onDismiss={dismissPrompt}
        onEnable={() => void requestPermission()}
      />
    </section>
  )
}

function PermissionPromptDialog({
  open,
  onDismiss,
  onEnable,
}: {
  open: boolean
  onDismiss: () => void
  onEnable: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Enable lead notifications?</DialogTitle>
          <DialogDescription>
            Get desktop alerts for new web leads assigned to you while the app
            is open. Your browser will ask for permission next. In-app
            notifications work either way.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          We’ll only ask once in this browser. You can change notification
          permission later in your browser’s site settings.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>
            Not now
          </Button>
          <Button onClick={onEnable}>Enable notifications</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeniedPermissionGuidance({
  visible,
  onDismiss,
}: {
  visible: boolean
  onDismiss: () => void
}) {
  if (!visible) return null
  return (
    <aside
      aria-label="Browser notification settings"
      className="rounded-xl border bg-card/90 p-3 text-xs text-card-foreground shadow-md backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-foreground">
          Desktop notifications are blocked
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          aria-label="Dismiss notification settings guidance"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
      <p className="mt-1.5 text-muted-foreground">
        To turn them on in Chrome, click the tune or lock icon next to the
        address bar, open Site settings, set Notifications to Allow, and reload.
        In-app notifications still appear here.
      </p>
    </aside>
  )
}

function InboxStatus({
  connection,
  error,
}: {
  connection: InboxConnection
  error: string
}) {
  return (
    <>
      {connection === 'disconnected' && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          Updates unavailable. This list may be out of date. We’ll retry
          automatically.
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border bg-card p-3 text-sm text-destructive shadow-lg"
        >
          {error}
        </p>
      )}
    </>
  )
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
