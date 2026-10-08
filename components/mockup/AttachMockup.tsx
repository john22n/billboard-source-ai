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
  type MockupState,
} from '@/lib/mockup/state'

const formats = {
  bulletin: {
    field: 'image',
    receipt: 'receipt',
    retry: 'Retry image attachment',
    title: 'Send this mockup to Nutshell',
    confirm: 'Confirm & attach image',
  },
  poster: {
    field: 'poster',
    receipt: 'posterReceipt',
    retry: 'Retry poster attachment',
    title: 'Send this poster to Nutshell',
    confirm: 'Confirm & attach poster',
  },
} as const

export function AttachMockup({
  format = 'bulletin',
}: {
  format?: 'bulletin' | 'poster'
}) {
  const { state } = useMockupStore()
  const image =
    state.lastLead?.[formats[format].field] ??
    (format === 'bulletin' && !state.lastLead?.poster ? state.image : null)
  if (!image || !state.attachmentFailed) return null
  return <AttachmentRetry image={image} format={format} />
}

function retrySubmission(
  target: MockupState['lastLead'],
  field: 'image' | 'poster',
  receipt?: string,
) {
  const image = target?.[field]
  if (!target || !image || !receipt) return null
  if (!sameAdvertiser(target.advertiser, image.advertiser)) return null
  return { target, image, receipt }
}

/** The dialog owns a snapshot, so later revisions cannot change its upload. */
function AttachmentRetry({
  image,
  format,
}: {
  image: MockupImage
  format: 'bulletin' | 'poster'
}) {
  const { state, update, busy: generating } = useMockupStore()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<MockupState['lastLead']>(null)
  const [isPending, setIsPending] = useState(false)
  const [message, setMessage] = useState('')
  const labels = formats[format]
  const field = labels.field
  const { [labels.receipt]: receipt, [field]: submittedImage } = target ?? {}
  const preview = submittedImage ?? image
  const submission = retrySubmission(target, field, receipt)

  async function attach(
    target: LeadTarget,
    image: MockupImage,
    receipt: string,
  ) {
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
          receipt,
          image,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      const current = useMockupStore.getState()
      // Only clear the submitted snapshot, never a newer pending attachment.
      const saved = current.state.lastLead
      if (
        current.epoch !== epoch ||
        saved?.id !== target.id ||
        saved[field] !== image
      )
        return
      const lastLead = { ...saved, [field]: undefined }
      update({
        attachmentFailed: !!(lastLead.image || lastLead.poster),
        lastLead,
      })
      setOpen(false)
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
        Lead created; {format} could not be attached. Download is still
        available.
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
        {labels.retry}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>
              Retry the original submitted image for the lead already created
              below, not any later revision. The target cannot be changed, and
              this never creates a new lead.
            </DialogDescription>
          </DialogHeader>
          <AttachmentPreview
            target={target}
            image={preview}
            originalAvailable={!!(receipt && submittedImage)}
          />
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
              disabled={isPending || generating || !submission}
              onClick={() => {
                if (submission)
                  void attach(
                    submission.target,
                    submission.image,
                    submission.receipt,
                  )
              }}
            >
              {isPending ? 'Working…' : labels.confirm}
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
  originalAvailable,
}: {
  target: LeadTarget | null
  image: MockupImage
  originalAvailable: boolean
}) {
  return (
    <>
      {target && (
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
              This lead’s advertiser does not match {image.advertiser}. Download
              the image and check the original lead before attaching it
              manually.
            </p>
          )}
        </div>
      )}
      {!originalAvailable && (
        <p role="alert" className="text-sm text-destructive">
          This older mockup has no verified attachment target or original image.
          Download it and attach it to the created lead manually. Do not
          resubmit the Lead Form.
        </p>
      )}
    </>
  )
}
