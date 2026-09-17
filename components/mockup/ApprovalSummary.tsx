'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { useMockupStore } from '@/stores/mockupStore'
import type { Summary } from '@/lib/mockup/intake'

export function ApprovalSummary({
  onGenerate,
  busy,
}: {
  onGenerate: () => void
  busy: boolean
}) {
  const { state, update } = useMockupStore()
  const { summary, intake, brand } = state
  if (!summary) return null
  const edit = (key: keyof Summary, value: string) =>
    update({ summary: { ...summary, [key]: value } })
  const wordCount =
    `${summary.headline} ${summary.supporting} ${summary.contact}`
      .trim()
      .split(/\s+/).length
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-lg">Review your billboard</CardTitle>
        <p className="text-sm text-muted-foreground">
          Edit the exact copy below. No image request starts until you approve.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mockup-advertiser">Advertiser name</Label>
          <Input
            id="mockup-advertiser"
            value={intake.advertiser || ''}
            disabled={busy}
            onChange={(e) =>
              update({
                intake: { ...intake, advertiser: e.target.value },
                brand: {
                  notes: '',
                  logo: null,
                  receipt: null,
                  fallback:
                    'Advertiser name edited. Using the name as text; no logo.',
                },
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mockup-headline">Headline</Label>
          <Input
            id="mockup-headline"
            value={summary.headline}
            maxLength={200}
            disabled={busy}
            onChange={(e) => edit('headline', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mockup-supporting">
            Supporting / required copy (exact text)
          </Label>
          <Textarea
            id="mockup-supporting"
            value={summary.supporting}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => edit('supporting', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mockup-contact">
            Contact details on the billboard
          </Label>
          <Input
            id="mockup-contact"
            value={summary.contact}
            maxLength={500}
            disabled={busy}
            onChange={(e) => edit('contact', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mockup-direction">Tone and visual direction</Label>
          <Textarea
            id="mockup-direction"
            value={summary.direction}
            maxLength={1000}
            disabled={busy}
            onChange={(e) => edit('direction', e.target.value)}
          />
        </div>
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
        <p className="text-xs text-muted-foreground">
          One image request. Up to 10 successful requests per day, including
          revisions. Resets at midnight America/Denver.
        </p>
      </CardContent>
    </Card>
  )
}
