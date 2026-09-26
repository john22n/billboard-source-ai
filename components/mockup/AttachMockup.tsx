'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
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
} from '@/lib/mockup/state'

export function AttachMockup() {
  const { state, update, busy: generating } = useMockupStore()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<LeadTarget | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [message, setMessage] = useState('')
  const image = state.image
  if (!image || !state.attachmentFailed) return null

  async function attach(target: LeadTarget, image: MockupImage) {
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
          receipt: target.receipt,
          image,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      const current = useMockupStore.getState()
      if (
        current.epoch !== epoch ||
        current.state.lastLead?.id !== target.id ||
        current.state.image?.id !== image.id
      )
        return
      update({ attachmentFailed: false })
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
              Retry the image for the lead already created below. The target
              cannot be changed, and this never creates a new lead.
            </DialogDescription>
          </DialogHeader>
          {target && <AttachmentPreview target={target} image={image} />}
          {!target?.receipt && (
            <p role="alert" className="text-sm text-destructive">
              This older mockup has no verified attachment target. Download it
              and attach it to the created lead manually. Do not resubmit the
              Lead Form.
            </p>
          )}
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
                generating ||
                !target?.receipt ||
                !sameAdvertiser(target.advertiser, image.advertiser)
              }
              onClick={() => {
                if (target?.receipt) void attach(target, image)
              }}
            >
              {isPending ? 'Working…' : 'Confirm & attach image'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
          This lead’s advertiser does not match {image.advertiser}. Download the
          image and check the original lead before attaching it manually.
        </p>
      )}
    </div>
  )
}
