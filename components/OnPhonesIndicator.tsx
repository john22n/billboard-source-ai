'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

export function OnPhonesIndicator() {
  const { workers, isLoading, error } = useAvailableWorkers()

  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-border px-3 py-1 animate-pulse">
        <div className="size-3.5 rounded-full bg-muted-foreground/20" />
        <div className="h-3 w-28 rounded-full bg-muted-foreground/10" />
      </div>
    )
  }

  if (error) return null

  const active = workers.length > 0

  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
      <Phone
        className={cn(
          'size-3.5 shrink-0',
          active ? 'text-indigo-600 animate-pulse' : 'text-muted-foreground',
        )}
      />
      <span className="flex items-center gap-1.5 min-w-0">
        {active ? (
          workers.map((worker, i) => (
            <span key={worker.name} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-muted-foreground select-none">·</span>
              )}
              {worker.status === 'on_call' && (
                <span className="inline-block size-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
              )}
              <span
                className={cn(
                  'truncate',
                  worker.status === 'on_call'
                    ? 'text-green-600'
                    : 'text-foreground',
                )}
              >
                {worker.name}
              </span>
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">No one on phones</span>
        )}
      </span>
    </div>
  )
}