'use client'

import { Button } from '@/components/ui/button'
import { useMockupStore } from '@/stores/mockupStore'

export function ApprovalSummary({
  onGenerate,
  busy,
}: {
  onGenerate: () => void
  busy: boolean
}) {
  const { state } = useMockupStore()
  const { summary, intake } = state
  if (!summary) return null
  const wordCount =
    `${summary.headline} ${summary.supporting} ${summary.contact}`
      .trim()
      .split(/\s+/).length
  return (
    <div className="space-y-4">
      <section
        aria-label="Brief summary"
        className="space-y-1 rounded-lg border p-4"
      >
        <h3 className="font-semibold">{summary.headline}</h3>
        {summary.supporting && <p className="text-sm">{summary.supporting}</p>}
        {summary.contact && (
          <p className="text-sm text-muted-foreground">{summary.contact}</p>
        )}
      </section>
      {(summary.caution || wordCount > 20) && (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          {summary.caution ||
            'This is a lot to read at driving speed. Consider one short headline and one contact detail. Keep any legally required disclaimer.'}
        </p>
      )}
      <Button
        onClick={onGenerate}
        disabled={busy || !intake.advertiser?.trim()}
        className="w-full"
      >
        {busy ? 'Generating mockup…' : 'Generate mockup'}
      </Button>
    </div>
  )
}
