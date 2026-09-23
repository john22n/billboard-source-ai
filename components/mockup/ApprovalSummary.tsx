'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useMockupStore } from '@/stores/mockupStore'

export function ApprovalSummary({
  onGenerate,
  busy,
}: {
  onGenerate: () => void
  busy: boolean
}) {
  const { state } = useMockupStore()
  const { summary, intake, brand } = state
  if (!summary) return null
  const wordCount =
    `${summary.headline} ${summary.supporting} ${summary.contact}`
      .trim()
      .split(/\s+/).length
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-lg">Billboard summary</CardTitle>
        <p className="text-sm text-muted-foreground">
          No image request starts until you choose Generate mockup.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-3 text-sm">
          {[
            ['Advertiser', intake.advertiser],
            ['Headline', summary.headline],
            ['Supporting copy', summary.supporting],
            ['Contact details', summary.contact],
            ['Visual direction', summary.direction],
          ].map(
            ([label, value]) =>
              value && (
                <div key={label} className="space-y-1">
                  <dt className="font-medium text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{value}</dd>
                </div>
              ),
          )}
        </dl>
        {brand?.logo && (
          <div className="rounded-md border p-3">
            <Image
              src={brand.logo}
              alt={`${intake.advertiser} website logo`}
              width={180}
              height={80}
              className="max-h-20 w-auto object-contain"
              unoptimized
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Logo retrieved only from {intake.website}
            </p>
          </div>
        )}
        {brand?.notes && (
          <p className="text-sm text-muted-foreground">{brand.notes}</p>
        )}
        {brand?.fallback && (
          <p className="text-sm text-muted-foreground">{brand.fallback}</p>
        )}
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
      </CardContent>
    </Card>
  )
}
