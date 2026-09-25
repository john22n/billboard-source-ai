'use client'

import { useEffect, useId, useRef } from 'react'
import Image from 'next/image'
import {
  ArrowUp,
  Download,
  ImageIcon,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useMockupStore } from '@/stores/mockupStore'
import { useFormStore } from '@/stores/formStore'
import { getErrorMessage } from '@/lib/error-handling'
import {
  MAX_MESSAGES,
  START_COMMAND,
  type ChatMessage,
  type MockupState,
} from '@/lib/mockup/state'
import { AttachMockup } from './AttachMockup'
import { MockupAttachments } from './MockupAttachments'

export function ArtMockupWizard() {
  const epoch = useMockupStore((store) => store.epoch)
  return <MockupConversation key={epoch} />
}

function MockupConversation() {
  const {
    state,
    sessionKey,
    busy: isPending,
    storageWarning,
    start,
    draft,
    error,
    opening,
    setDraft,
  } = useMockupStore()
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [state.messages.length, isPending])

  // "Start" is sent on the rep's behalf so the wizard opens with Question 1.
  useEffect(() => {
    if (!opening || !sessionKey) return
    useMockupStore.setState({ opening: null })
    void sendMessage(opening)
  }, [opening, sessionKey])

  function send() {
    const text = draft.trim()
    if (START_COMMAND.test(text)) {
      start()
      return
    }
    if (text) void sendMessage(text)
  }

  return (
    <section
      aria-label="Creative Studio"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <MockupHeader />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <MockupWelcome />
          <div
            role="log"
            aria-label="Mockup conversation"
            aria-live="polite"
            className="space-y-5"
          >
            {state.messages.map((message, index) => (
              <ConversationMessage key={index} message={message} />
            ))}
          </div>
          {state.image && <SelectedMockup image={state.image} />}
          <MockupProgress />
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {storageWarning && (
            <p role="alert" className="text-sm text-destructive">
              {storageWarning}
            </p>
          )}
          <div ref={end} />
        </div>
      </div>
      <MockupComposer draft={draft} setDraft={setDraft} send={send} />
    </section>
  )
}

function SelectedMockup({
  image,
}: {
  image: NonNullable<MockupState['image']>
}) {
  return (
    <figure className="space-y-3">
      <Image
        src={image.dataUrl}
        alt={`Selected outdoor billboard concept for ${image.advertiser}`}
        width={1536}
        height={1024}
        unoptimized
        className="h-auto w-full rounded-lg border"
      />
      <figcaption className="text-xs text-muted-foreground">
        Concept only · Check text and brand details before sharing.
      </figcaption>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a
            href={image.dataUrl}
            download={`billboard-concept-${image.id}.jpg`}
          >
            <Download data-icon="inline-start" className="size-4" />
            Download selected mockup
          </a>
        </Button>
        <AttachMockup />
      </div>
    </figure>
  )
}

function MockupProgress() {
  const { busy, preparingFiles } = useMockupStore()
  if (!busy) return null
  return (
    <p role="status" className="animate-pulse text-sm text-muted-foreground">
      {preparingFiles
        ? 'Preparing file previews…'
        : 'The wizard is working. Rendering a billboard can take a couple of minutes; your current image stays selected.'}
    </p>
  )
}

function MockupHeader() {
  const { start, sessionKey } = useMockupStore()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ImageIcon className="size-4 text-primary" />
          Creative Studio
        </h2>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!sessionKey}
        onClick={() => start()}
      >
        <RotateCcw data-icon="inline-start" className="size-4" />
        Start Mockup
      </Button>
    </header>
  )
}

function MockupWelcome() {
  const { state, busy: isPending, sessionKey, start } = useMockupStore()
  if (state.messages.length) return null
  return (
    <div className="space-y-4 py-6">
      <h3 className="text-3xl font-semibold tracking-tight">
        Create a billboard
      </h3>
      <p className="text-base text-muted-foreground">
        Say “Start” and the wizard asks one question at a time, reviews the
        advertiser’s website, then renders the mockup. Attach a logo or
        background any time.
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending || !sessionKey}
        onClick={() => start({ ...useFormStore.getState().getFormData() })}
      >
        Use current lead form
      </Button>
    </div>
  )
}

function ConversationMessage({ message }: { message: ChatMessage }) {
  return (
    <div
      className={
        message.role === 'user'
          ? 'ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-sm whitespace-pre-wrap'
          : 'max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap'
      }
    >
      <span className="sr-only">
        {message.role === 'user' ? 'You: ' : 'Wizard: '}
      </span>
      {message.text}
    </div>
  )
}

function MockupComposer({
  draft,
  setDraft,
  send,
}: {
  draft: string
  setDraft: (value: string) => void
  send: () => void
}) {
  const { state, busy: isPending, sessionKey } = useMockupStore()
  const messageId = useId()
  const isLoading = isPending || !sessionKey
  return (
    <footer className="max-h-[65%] shrink-0 overflow-y-auto border-t bg-background px-4 py-3 sm:px-6">
      <form
        className="mx-auto max-w-3xl space-y-2"
        aria-busy={isPending}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <MockupAttachments>
          <Label htmlFor={messageId} className="sr-only">
            Message
          </Label>
          <Textarea
            id={messageId}
            value={draft}
            disabled={!sessionKey}
            readOnly={isPending}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
            rows={1}
            className="min-h-9 min-w-0 resize-none border-0 shadow-none focus-visible:ring-0"
            placeholder={
              state.image
                ? 'Describe a revision, or say Start for a new mockup…'
                : state.messages.length
                  ? 'Reply to the wizard… (or say skip)'
                  : 'Say Start to begin…'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!draft.trim() || isLoading}
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </Button>
        </MockupAttachments>
        <p role="status" className="sr-only">
          {isPending ? 'Working…' : ''}
        </p>
      </form>
    </footer>
  )
}

/**
 * Sends one user message and appends the wizard's reply. Late responses from a
 * previous mockup (a different epoch) are discarded, and a failed request keeps
 * the draft, conversation and selected image untouched.
 */
async function sendMessage(text: string) {
  const store = useMockupStore.getState()
  if (store.busy || !store.sessionKey) return
  const { epoch, state } = store
  const messages = [...state.messages, { role: 'user' as const, text }].slice(
    -MAX_MESSAGES,
  )
  useMockupStore.setState({ busy: true, error: '' })
  const outcome = await requestReply({
    messages,
    attachments: state.attachments,
    image: state.image,
    brand: state.brand,
  })
  if (useMockupStore.getState().epoch !== epoch) return
  useMockupStore.setState({ busy: false })
  if (outcome.kind === 'unauthorized') return useMockupStore.getState().clear()
  if (outcome.kind === 'error')
    return useMockupStore.setState({ error: outcome.message })
  useMockupStore.getState().update({
    messages: [
      ...messages,
      { role: 'assistant' as const, text: outcome.reply },
    ].slice(-MAX_MESSAGES),
    image: outcome.image ?? state.image,
    brand: outcome.brand ?? state.brand,
  })
  useMockupStore.setState({ draft: '' })
}

type ReplyOutcome =
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }
  | {
      kind: 'reply'
      reply: string
      image: MockupState['image'] | null
      brand: MockupState['brand'] | null
    }

/** Posts one turn to the wizard; network and server failures become messages. */
async function requestReply(
  body: Pick<MockupState, 'messages' | 'attachments' | 'image' | 'brand'>,
): Promise<ReplyOutcome> {
  try {
    const response = await fetch('/api/mockup/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (response.status === 401) return { kind: 'unauthorized' }
    if (!response.ok)
      return {
        kind: 'error',
        message: result.error || 'Request failed. Please try again.',
      }
    return {
      kind: 'reply',
      reply: String(result.reply || ''),
      image: result.image ?? null,
      brand: result.brand ?? null,
    }
  } catch (err) {
    return { kind: 'error', message: getErrorMessage(err) }
  }
}
