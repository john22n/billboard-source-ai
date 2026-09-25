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
  nextQuestion,
  questions,
  type MockupState,
  type Question,
} from '@/lib/mockup/intake'
import { ApprovalSummary } from './ApprovalSummary'
import { AttachMockup } from './AttachMockup'
import { MockupAttachments } from './MockupAttachments'

export function ArtMockupWizard() {
  const { state, sessionKey, epoch, start } = useMockupStore()
  useEffect(() => {
    if (sessionKey && !state.started)
      start({ ...useFormStore.getState().getFormData() })
  }, [sessionKey, state.started, start])
  return <MockupConversation key={epoch} />
}

function MockupConversation() {
  const {
    state,
    sessionKey,
    busy: isPending,
    storageWarning,
    update,
    start,
    draft,
    error,
    setDraft,
  } = useMockupStore()
  const end = useRef<HTMLDivElement>(null)
  const question = nextQuestion(state.intake)
  const step = Object.keys(questions).filter(
    (key) => state.intake[key as keyof typeof questions] !== null,
  ).length

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [state.messages.length, isPending])

  async function request(kind: 'intake' | 'generate', text = '') {
    if (useMockupStore.getState().busy || !sessionKey) return
    const started = useMockupStore.getState().epoch
    useMockupStore.setState({ busy: true, error: '' })
    try {
      const result = await postMockup(kind, state, text, started)
      if (!result) return
      const messages = [
        ...state.messages,
        ...(text ? [{ role: 'user' as const, text }] : []),
      ].slice(-80)
      if (kind === 'generate') {
        update({
          image: result.image,
          messages: [
            ...messages,
            {
              role: 'assistant',
              text: 'Your mockup is ready. Check every word before sharing. Tell me what you’d like to change.',
            },
          ],
        })
      } else {
        update(intakeReply(result, messages, question))
      }
      setDraft('')
    } catch (err) {
      if (useMockupStore.getState().epoch !== started) return
      useMockupStore.setState({ error: getErrorMessage(err) })
    } finally {
      if (useMockupStore.getState().epoch === started)
        useMockupStore.setState({ busy: false })
    }
  }

  function send() {
    const text = draft.trim()
    if (/^(start|start mockup)[.!]?$/i.test(text)) {
      start()
      return
    }
    if (text) void request(state.image ? 'generate' : 'intake', text)
  }

  return (
    <section
      aria-label="Creative Studio"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <MockupHeader step={step} />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <MockupWelcome step={step} />
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
          {!question && !state.summary && (
            <Button disabled={isPending} onClick={() => void request('intake')}>
              Review brief
            </Button>
          )}
          {!state.image && (
            <ApprovalSummary
              busy={isPending}
              onGenerate={() => void request('generate')}
            />
          )}
          {state.image && (
            <figure className="space-y-3">
              <Image
                src={state.image.dataUrl}
                alt={`Selected outdoor billboard concept for ${state.image.advertiser}`}
                width={1536}
                height={1024}
                unoptimized
                className="h-auto w-full rounded-lg border"
              />
              <figcaption className="text-xs text-muted-foreground">
                Concept mockup · Not print-ready artwork. Verify spelling,
                contact details, brand accuracy, and legal copy before sharing.
              </figcaption>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a
                    href={state.image.dataUrl}
                    download={`billboard-concept-${state.image.id}.jpg`}
                  >
                    <Download data-icon="inline-start" className="size-4" />
                    Download selected mockup
                  </a>
                </Button>
                <AttachMockup />
              </div>
              <p className="text-xs text-muted-foreground">
                This selected image accompanies your next matching Lead Form
                submission. New revisions are never automatically sent to an
                existing lead.
              </p>
            </figure>
          )}
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

function MockupProgress() {
  const { busy, preparingFiles, state } = useMockupStore()
  if (!busy) return null
  return (
    <p role="status" className="animate-pulse text-sm text-muted-foreground">
      {preparingFiles
        ? 'Preparing file previews…'
        : state.summary
          ? 'Rendering your billboard. This can take a couple of minutes. Your current image stays selected.'
          : 'Reading your answer and preparing the next step…'}
    </p>
  )
}

function MockupHeader({ step }: { step: number }) {
  const { state, start } = useMockupStore()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <ImageIcon className="size-4 text-primary" />
          Creative Studio
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          One billboard. One clear idea.{' '}
          {state.image
            ? 'Concept, not print-ready artwork.'
            : `${step} of 7 intake answers ready.`}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => start()}>
        <RotateCcw data-icon="inline-start" className="size-4" />
        Start Mockup
      </Button>
    </header>
  )
}

function MockupWelcome({ step }: { step: number }) {
  const { state, busy: isPending, start } = useMockupStore()
  const question = nextQuestion(state.intake)
  if (state.messages.length) return null
  return (
    <div className="space-y-4 py-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Billboard Source · Creative studio
      </p>
      <h3 className="text-3xl font-semibold tracking-tight">
        Let’s put your idea
        <br />
        on a billboard.
      </h3>
      <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        We’ll build a short brief together, then turn it into one realistic
        outdoor concept. Your Lead Form stays unchanged.
      </p>
      {step > 0 && (
        <p className="text-sm">
          I’ve brought over the usable facts from your current Lead Form.
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={isPending}
        onClick={() => start({ ...useFormStore.getState().getFormData() })}
      >
        Use current lead form
      </Button>
      <p className="pt-3 text-base">
        {question
          ? questions[question]
          : 'Your intake is ready. Review the brief before generating.'}
      </p>
    </div>
  )
}

function ConversationMessage({
  message,
}: {
  message: MockupState['messages'][number]
}) {
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
            {state.image ? 'Revision instructions' : 'Your answer'}
          </Label>
          <div className="flex items-end gap-2 rounded-xl border p-2">
            <Textarea
              id={messageId}
              value={draft}
              disabled={isLoading}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              rows={2}
              className="min-h-14 resize-none border-0 shadow-none focus-visible:ring-0"
              placeholder={
                state.image
                  ? 'Make the headline bigger, simplify, or try a more premium feel…'
                  : 'Your answer… (or say skip)'
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
              aria-label={state.image ? 'Generate revision' : 'Send answer'}
              disabled={!draft.trim() || isLoading}
            >
              {isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </div>
        </MockupAttachments>
        <p role="status" className="text-xs text-muted-foreground">
          {state.image
            ? 'Sending a revision immediately starts another image request—no additional approval step.'
            : 'Enter to send · Shift+Enter for a new line · Say “skip” to move on.'}{' '}
          Active session only; no saved history.
        </p>
      </form>
    </footer>
  )
}

async function postMockup(
  kind: 'intake' | 'generate',
  state: MockupState,
  text: string,
  epoch: number,
) {
  const response = await fetch(`/api/mockup/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(kind, state, text)),
  })
  const result = await response.json()
  if (useMockupStore.getState().epoch !== epoch) return null
  if (response.status === 401) {
    useMockupStore.getState().clear()
    return null
  }
  if (!response.ok)
    throw new Error(result.error || 'Request failed. Please try again.')
  return result
}

function requestBody(
  kind: 'intake' | 'generate',
  state: MockupState,
  text: string,
) {
  if (kind === 'intake')
    return {
      intake: state.intake,
      message: text,
      review: !nextQuestion(state.intake),
      ...(state.attachments.length
        ? {
            attachments: state.attachments,
            attachmentInstructions: [
              ...state.messages
                .filter((message) => message.role === 'user')
                .map((message) => message.text),
              text,
            ]
              .join('\n')
              .slice(-8000),
          }
        : {}),
    }
  const brand = state.brand ?? { logo: null, receipt: null, notes: '' }
  return {
    intake: state.intake,
    summary: state.summary,
    approved: !state.image,
    previous: state.image,
    revision: text,
    logo: brand.logo,
    logoReceipt: brand.receipt,
    brandNotes: brand.notes,
    ...(state.attachments.length ? { attachments: state.attachments } : {}),
  }
}

function intakeReply(
  result: Pick<MockupState, 'intake' | 'summary' | 'brand'>,
  messages: MockupState['messages'],
  previousQuestion: Question | undefined,
): Partial<MockupState> {
  const next = nextQuestion(result.intake)
  const reply = next
    ? questions[next]
    : 'Here’s your summary. When you’re ready, choose Generate mockup.'
  return {
    intake: result.intake,
    summary: result.summary || null,
    brand: result.brand || null,
    messages: [
      ...messages,
      {
        role: 'assistant',
        text:
          next && next === previousQuestion
            ? 'I couldn’t match that response to the current question. Please rephrase your answer, or say “skip” to move on.'
            : reply,
      },
    ],
  }
}
