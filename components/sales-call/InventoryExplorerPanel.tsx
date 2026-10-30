'use client'

import { useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'

const INVENTORY_EXPLORER_URL = 'https://geopoepoe.com/gpp/v3/inventory-explorer'
const createTypicalSchema = z.object({
  type: z.literal('gpp:create-typical'),
  version: z.literal(1),
  generatorUrl: z.string().startsWith('https://geopoepoe.com/'),
})

interface InventoryExplorerPanelProps {
  city?: string
  state?: string
  collapseFilters?: boolean
  onCreateTypical?: (generatorUrl: string) => void
}

export function InventoryExplorerPanel({
  city,
  state,
  collapseFilters = false,
  onCreateTypical,
}: InventoryExplorerPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!onCreateTypical) return
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://geopoepoe.com' ||
        !event.source ||
        event.source !== iframeRef.current?.contentWindow
      )
        return
      const message = createTypicalSchema.safeParse(event.data)
      if (!message.success) return

      // Acknowledge synchronously, before React renders or the generator loads.
      event.source.postMessage(
        { type: 'gpp:create-typical-ack', version: 1 },
        event.origin,
      )
      onCreateTypical(message.data.generatorUrl)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onCreateTypical])

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
      ref={iframeRef}
      src={src}
      className="h-full min-h-[300px] w-full rounded-lg border-0"
      title="Inventory Explorer"
    />
  )
}
