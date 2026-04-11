'use client'

import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * Semi-transparent backdrop that appears behind the sidebar when it is open.
 * Clicking it closes the sidebar. Only renders on desktop — mobile already
 * uses a Sheet with its own built-in backdrop.
 */
export function SidebarOverlay() {
  const { open, setOpen, isMobile } = useSidebar()

  if (isMobile) return null

  return (
    <div
      aria-hidden="true"
      onClick={() => setOpen(false)}
      className={cn(
        'fixed inset-0 z-[9] bg-black/40',
        'transition-opacity duration-200 ease-linear',
        open
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none',
      )}
    />
  )
}
