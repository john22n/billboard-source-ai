'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

export function OnPhonesIndicator() {
  const { count, names, isLoading, error } = useAvailableWorkers()

  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-primary/20 px-3 py-1 animate-pulse">
        <div className="size-3.5 rounded-full bg-primary/20" />
        <div className="h-3 w-28 rounded-full bg-primary/10" />
      </div>
    )
  }

  if (error) return null

  const active = count > 0

  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full border border-primary/20 px-3 py-1 text-sm transition-all duration-300">
      <Phone
        className={cn('size-3.5 text-primary shrink-0', active && 'animate-pulse')}
      />
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-primary tabular-nums">{count}</span>
        <span className="text-muted-foreground select-none">·</span>
        <span className={cn('truncate', active ? 'text-foreground' : 'text-muted-foreground')}>
          {active ? names.join(', ') : 'No one on phones'}
        </span>
      </span>
    </div>
  )
}
