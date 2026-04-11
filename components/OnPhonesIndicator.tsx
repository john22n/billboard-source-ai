'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

export function OnPhonesIndicator() {
  const { workers, isLoading, error } = useAvailableWorkers()

  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground animate-pulse">
        <Phone className="size-3.5" />
        <span className="h-4 w-24 rounded bg-muted" />
      </div>
    )
  }

  if (error) {
    return null
  }

  const count = workers.length

  if (count === 0) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
        <Phone className="size-3.5" />
        <span>No one on phones</span>
      </div>
    )
  }

  const names = workers.map((w) => w.displayName).join(', ')

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-sm">
      <Phone className="size-3.5 text-green-500" />
      <span className="text-muted-foreground">
        On Phones:{' '}
        <span className="font-medium text-foreground">{names}</span>
      </span>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full px-1.5 py-0.5',
          'text-[11px] font-semibold leading-none',
          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        )}
      >
        {count}
      </span>
    </div>
  )
}
