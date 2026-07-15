'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import type { WorkerEntry } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

function WorkerStatus({
  worker,
  index,
}: {
  worker: WorkerEntry
  index: number
}) {
  if (worker.status === 'busy') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <span className="inline-block size-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
        {worker.name}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-background border border-border">
      <span className="text-muted-foreground/60 text-xs">{index + 1}</span>
      {worker.name}
      {index === 0 && (
        <span className="text-indigo-500 text-xs font-medium">next</span>
      )}
    </span>
  )
}

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
    <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2 py-1 text-sm">
      <Phone
        className={cn(
          'size-3.5 shrink-0 mx-1',
          active ? 'text-indigo-600 animate-pulse' : 'text-muted-foreground',
        )}
      />
      <span className="flex items-center gap-1 min-w-0">
        {active ? (
          workers.map((worker, i) => (
            <span key={worker.id} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-muted-foreground/50 select-none text-xs">
                  ·
                </span>
              )}
              <WorkerStatus worker={worker} index={i} />
            </span>
          ))
        ) : (
          <span className="text-muted-foreground text-xs px-1">
            No one on phones
          </span>
        )}
      </span>
    </div>
  )
}
