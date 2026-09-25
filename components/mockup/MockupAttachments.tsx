'use client'

import { useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMockupStore } from '@/stores/mockupStore'
import { attachmentLabel, MAX_ATTACHMENTS } from '@/lib/mockup/attachments'
import { prepareAttachment } from '@/lib/mockup/prepare-attachment'
import { getErrorMessage } from '@/lib/error-handling'

export function MockupAttachments({ children }: { children: ReactNode }) {
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { state, busy, sessionKey, update } = useMockupStore()

  async function addFiles(files: File[]) {
    const current = useMockupStore.getState()
    if (current.busy || !current.sessionKey) return
    if (current.state.attachments.length + files.length > MAX_ATTACHMENTS) {
      useMockupStore.setState({
        error: 'Use up to 3 reference files. Remove one before adding more.',
      })
      return
    }
    const epoch = current.epoch
    let preparationError = ''
    useMockupStore.setState({ busy: true, preparingFiles: true, error: '' })
    try {
      // Prepare the batch atomically; a bad file never discards existing references.
      const attachments = []
      for (const file of files) attachments.push(await prepareAttachment(file))
      if (useMockupStore.getState().epoch !== epoch) return
      update({
        attachments: [...current.state.attachments, ...attachments],
        ...(!current.state.image ? { summary: null } : {}),
      })
    } catch (error) {
      preparationError = getErrorMessage(error)
    } finally {
      if (useMockupStore.getState().epoch === epoch)
        useMockupStore.setState({
          busy: false,
          preparingFiles: false,
          error: preparationError,
        })
    }
  }

  return (
    <div
      className={`space-y-3 rounded-xl ${dragging ? 'outline-2 outline-offset-4 outline-primary' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (event.dataTransfer.files.length)
          void addFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
          multiple
          hidden
          aria-label="Reference files"
          onChange={(event) => {
            if (event.target.files?.length)
              void addFiles(Array.from(event.target.files))
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !sessionKey}
          onClick={() => picker.current?.click()}
        >
          <Paperclip className="size-4" data-icon="inline-start" />
          Attach files
        </Button>
        <span className="text-xs text-muted-foreground">
          or drop PNG, JPEG, PDF · 3 files · 10 MB each
        </span>
      </div>
      {state.attachments.length > 0 && (
        <>
          <ul
            aria-label="Reference attachments"
            className="grid grid-cols-3 gap-2"
          >
            {state.attachments.map((file) => (
              <li
                key={file.id}
                className="relative min-w-0 overflow-hidden rounded-lg border bg-muted/30"
              >
                <Image
                  src={file.dataUrl}
                  alt={attachmentLabel(file)}
                  width={160}
                  height={80}
                  unoptimized
                  className="h-16 w-full object-contain"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1 right-1 size-6"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy}
                  onClick={() =>
                    update({
                      attachments: state.attachments.filter(
                        (item) => item.id !== file.id,
                      ),
                      ...(!state.image ? { summary: null } : {}),
                    })
                  }
                >
                  <X className="size-3" />
                </Button>
                <p
                  className="truncate border-t px-2 py-1 text-xs"
                  title={attachmentLabel(file)}
                >
                  {file.name}
                </p>
                {file.sourceType === 'application/pdf' && (
                  <p className="px-2 pb-1 text-xs text-muted-foreground">
                    PDF · Page 1 only
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            References stay with this mockup. Describe how to use them in your
            message. PDFs use page 1 only.
          </p>
        </>
      )}
      {children}
    </div>
  )
}
