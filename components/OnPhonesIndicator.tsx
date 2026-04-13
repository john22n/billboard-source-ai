'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'

export function OnPhonesIndicator() {
  const { count, isLoading, error } = useAvailableWorkers()

  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground animate-pulse">
        <Phone className="size-3.5" />
        <span className="h-4 w-20 rounded bg-muted" />
      </div>
    )
  }

  if (error) {
    return null
  }

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
      <Phone className="size-3.5" />
      <span> {count} on phones</span>
    </div>
  )
}
