'use client'

import { useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMockupStore } from '@/stores/mockupStore'
import { attachmentLabel, MAX_ATTACHMENTS } from '@/lib/mockup/attachments'
import { prepareAttachment } from '@/lib/mockup/prepare-attachment'
import { getErrorMessage } from '@/lib/error-handling'
import { PdfReferenceSearch } from './PdfReferenceSearch'

export function MockupAttachments({ children }: { children: ReactNode }) {
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { state, busy, sessionKey, update } = useMockupStore()

  async function addFiles(files: File[]) {
    const current = useMockupStore.getState()
    if (current.busy || !current.sessionKey) return
    if (current.state.attachments.length + files.length > MAX_ATTACHMENTS) {
      useMockupStore.setState({
        error: 'Use one reference file. Remove it before attaching another.',
      })
      return
    }
    const epoch = current.epoch
    let preparationError = ''
    useMockupStore.setState({ busy: true, preparingFiles: true, error: '' })
    try {
      const file = files[0]
      const attachment = await prepareAttachment(file)
      if (useMockupStore.getState().epoch !== epoch) return
      useMockupStore.setState({
        pdfSource: file.type === 'application/pdf' ? file : null,
      })
      update({
        attachments: [attachment],
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
          Attach file
        </Button>
        <span className="text-xs text-muted-foreground">
          PNG, JPEG, PDF · 1 file · 10 MB · PDFs up to 50 pages
        </span>
      </div>
      {state.attachments.length > 0 && (
        <>
          <ul aria-label="Reference attachments" className="space-y-2">
            {state.attachments.map((file) => (
              <li
                key={file.id}
                className="relative flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border bg-muted/30 pr-9"
              >
                <Image
                  src={file.dataUrl}
                  alt={attachmentLabel(file)}
                  width={160}
                  height={80}
                  unoptimized
                  className="h-16 w-24 shrink-0 object-contain"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute top-1 right-1 size-6"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy}
                  onClick={() => {
                    useMockupStore.setState({ pdfSource: null })
                    update({
                      attachments: [],
                      ...(!state.image ? { summary: null } : {}),
                    })
                  }}
                >
                  <X className="size-3" />
                </Button>
                <div className="min-w-0 py-2">
                  <p
                    className="truncate text-xs font-medium"
                    title={attachmentLabel(file)}
                  >
                    {file.name}
                  </p>
                  {file.sourceType === 'application/pdf' && (
                    <p className="text-xs text-muted-foreground">
                      PDF · Page {file.pageNumber ?? 1} of {file.pageCount ?? 1}
                    </p>
                  )}
                  {file.searchQuery && (
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={file.searchQuery}
                    >
                      Selected for: {file.searchQuery}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {state.attachments[0].sourceType === 'application/pdf' && (
            <PdfReferenceSearch />
          )}
          <p className="text-xs text-muted-foreground">
            References stay with this mockup. Describe how to use them in your
            message. For PDFs, the selected page is used as the reference.
          </p>
        </>
      )}
      {children}
    </div>
  )
}
