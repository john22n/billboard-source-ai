'use client'

import { useMemo } from 'react'

const INVENTORY_EXPLORER_URL = 'https://geopoepoe.com/a/inventory_explorer.html'

interface InventoryExplorerPanelProps {
  city?: string
  state?: string
  collapseFilters?: boolean
}

export function InventoryExplorerPanel({
  city,
  state,
  collapseFilters = false,
}: InventoryExplorerPanelProps) {
  const src = useMemo(() => {
    const params = new URLSearchParams({ embed: '1' })
    const trimmedCity = city?.trim()
    const trimmedState = state?.trim()

    if (trimmedCity) params.set('city', trimmedCity)
    if (trimmedState) params.set('state', trimmedState)
    if (collapseFilters) params.set('sidebar', '0')

    return `${INVENTORY_EXPLORER_URL}?${params.toString()}`
  }, [city, state, collapseFilters])

  return (
    <iframe
      src={src}
      className="h-full min-h-[300px] w-full rounded-lg border-0"
      title="Inventory Map"
    />
  )
}
