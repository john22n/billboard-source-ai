'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Radar, X } from 'lucide-react'

// Midnight after October 20, 2026 in America/Denver (MDT).
const expiresAt = Date.parse('2026-10-21T00:00:00-06:00')
const isBeforeExpiry = () => Date.now() < expiresAt
const hideOnServer = () => false

function subscribeToExpiry(onChange: () => void) {
  let timeout: ReturnType<typeof setTimeout>
  function checkExpiry() {
    onChange()
    if (isBeforeExpiry()) {
      // Clamp long waits to the browser timer limit, then check again.
      timeout = setTimeout(
        checkExpiry,
        Math.min(expiresAt - Date.now(), 2147483647),
      )
    }
  }
  checkExpiry()
  return () => clearTimeout(timeout)
}

export function LaunchAnnouncement({
  autoDismiss = false,
}: {
  autoDismiss?: boolean
}) {
  const [dismissed, setDismissed] = useState(false)
  const beforeExpiry = useSyncExternalStore(
    subscribeToExpiry,
    isBeforeExpiry,
    hideOnServer,
  )

  useEffect(() => {
    if (!autoDismiss || dismissed) return
    const timeout = window.setTimeout(() => setDismissed(true), 5000)
    return () => window.clearTimeout(timeout)
  }, [autoDismiss, dismissed])

  if (dismissed || !beforeExpiry) return null

  return (
    <aside
      aria-label="GeoPoePoe3 launch announcement"
      className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-2xl"
    >
      <div className="relative h-24 overflow-hidden bg-slate-950">
        <Radar
          aria-hidden="true"
          strokeWidth={0.6}
          className="absolute -right-8 -top-20 size-64 text-orange-400"
        />
        <span className="absolute bottom-4 left-6 font-mono text-xs uppercase tracking-[0.2em] text-orange-300">
          Coming Soon
        </span>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-slate-950 text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-orange-400"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="p-6">
        <h2 className="text-3xl font-semibold tracking-tight">GeoPoePoe3</h2>
        <p className="mt-5 border-t border-slate-200 pt-4 text-sm font-medium">
          October 20th
        </p>
      </div>
    </aside>
  )
}
