'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

export function OnPhonesIndicator() {
  const { count, isLoading, error } = useAvailableWorkers()

  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-border px-3 py-1 animate-pulse">
        <div className="size-3.5 rounded-full bg-muted" />
        <div className="h-3.5 w-20 rounded-full bg-muted" />
      </div>
    )
  }

  if (error) return null

  const active = count > 0

  return (
    <div
      className={cn(
        'hidden sm:flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
        'transition-all duration-500',
        active
          ? 'border-green-500/30 bg-green-500/[0.06] dark:bg-green-500/[0.08]'
          : 'border-red-500/20 bg-red-500/[0.05] dark:bg-red-500/[0.07]',
      )}
    >
      {/* Icon with live-pulse ring when active */}
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        {active && (
          <span className="animate-ping absolute inline-flex size-full rounded-full bg-green-400 opacity-25 dark:opacity-20" />
        )}
        <Phone
          className={cn(
            'size-3.5 transition-colors duration-500',
            active ? 'text-green-500' : 'text-red-500',
          )}
        />
      </span>

      {/* Count + label */}
      <span className="flex items-baseline gap-1 font-medium tracking-tight">
        <span
          className={cn('transition-colors duration-500', !active && 'text-muted-foreground')}
          style={active ? { color: 'var(--primary)' } : undefined}
        >
          {count}
        </span>
        <span className="text-muted-foreground font-normal">on phones</span>
      </span>
    </div>
  )
}
