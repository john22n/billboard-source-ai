'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useMockupStore } from '@/stores/mockupStore'
import {
  sameAdvertiser,
  type LeadTarget,
  type MockupImage,
} from '@/lib/mockup/intake'

export function AttachMockup() {
  const { state, update, busy: generating } = useMockupStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<LeadTarget[] | null>(null)
  const [target, setTarget] = useState<LeadTarget | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [message, setMessage] = useState('')
  const image = state.image
  if (!image || !state.attachmentFailed) return null

  async function search() {
    setIsPending(true)
    setMessage('')
    try {
      const response = await fetch(
        `/api/mockup/leads?q=${encodeURIComponent(query)}`,
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setLeads(result.leads)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed.')
    } finally {
      setIsPending(false)
    }
  }
  async function attach() {
    if (!target || !image) return
    setIsPending(true)
    setMessage('')
    const epoch = useMockupStore.getState().epoch
    try {
      const response = await fetch('/api/mockup/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: target.id,
          confirmedLeadId: target.id,
          image,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if (useMockupStore.getState().epoch !== epoch) return
      update({ lastLead: result.target, attachmentFailed: false })
      setMessage(
        `Image attached to ${target.name} (#${target.id}). Revisions will not be sent automatically.`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Attachment failed. Retry this image, not lead creation.',
      )
    } finally {
      setIsPending(false)
    }
  }
  return (
    <>
      <p role="status" className="text-sm">
        Lead created; image could not be attached. Download is still available.
      </p>
      <Button
        variant="outline"
        disabled={generating}
        onClick={() => {
          setOpen(true)
          setTarget(state.lastLead)
          setQuery(image.advertiser)
          setMessage('')
        }}
      >
        Retry image attachment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Send this mockup to Nutshell</DialogTitle>
            <DialogDescription>
              Choose the matching advertiser, then confirm the lead and selected
              image. This never creates a new lead.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <Label htmlFor="mockup-lead-search">
              Company / advertiser or lead name
            </Label>
            <div className="flex gap-2">
              <Input
                id="mockup-lead-search"
                value={query}
                maxLength={150}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="submit"
                disabled={isPending || query.trim().length < 2}
              >
                Search
              </Button>
            </div>
          </form>
          <LeadSearchResults
            leads={leads}
            target={target}
            disabled={isPending}
            onSelect={(lead) => {
              setTarget(lead)
              setMessage('')
            }}
          />
          {target && <AttachmentPreview target={target} image={image} />}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              disabled={
                isPending ||
                !target ||
                !sameAdvertiser(target.advertiser, image.advertiser)
              }
              onClick={() => void attach()}
            >
              {isPending ? 'Working…' : 'Confirm & attach image'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LeadSearchResults({
  leads,
  target,
  onSelect,
  disabled,
}: {
  leads: LeadTarget[] | null
  target: LeadTarget | null
  onSelect: (lead: LeadTarget) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      {leads?.map((lead) => (
        <Button
          key={lead.id}
          variant={target?.id === lead.id ? 'secondary' : 'outline'}
          className="h-auto w-full justify-start whitespace-normal text-left"
          onClick={() => onSelect(lead)}
          disabled={disabled}
        >
          {lead.name} · {lead.advertiser} · #{lead.id}
        </Button>
      ))}
      {leads?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No matching leads found. Try a more specific name.
        </p>
      )}
    </div>
  )
}

function AttachmentPreview({
  target,
  image,
}: {
  target: LeadTarget
  image: MockupImage
}) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="font-medium">
        Confirm: {target.name} (#{target.id})
      </p>
      <p className="text-sm">
        Advertiser: {target.advertiser || 'Not identified'}
      </p>
      <Image
        src={image.dataUrl}
        alt={`Selected ${image.advertiser} mockup to attach`}
        width={600}
        height={400}
        unoptimized
        className="h-auto w-full rounded"
      />
      {!sameAdvertiser(target.advertiser, image.advertiser) && (
        <p role="alert" className="text-sm text-destructive">
          This lead’s advertiser does not match {image.advertiser}. Select the
          matching lead instead.
        </p>
      )}
    </div>
  )
}
