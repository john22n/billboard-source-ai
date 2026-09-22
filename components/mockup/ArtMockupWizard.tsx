'use client'

import { useEffect, useRef, useState } from 'react'
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
import {
  nextQuestion,
  questions,
  type MockupState,
  type Question,
} from '@/lib/mockup/intake'
import { ApprovalSummary } from './ApprovalSummary'

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
    }
  return {
    intake: state.intake,
    summary: state.summary,
    approved: !state.image,
    previous: state.image,
    revision: text,
    logo: state.brand?.logo || null,
    logoReceipt: state.brand?.receipt || null,
  }
}

function applyResponse(
  response: Response,
  result: Pick<MockupState, 'intake' | 'summary' | 'brand' | 'image'> & {
    error?: string
  },
  kind: 'intake' | 'generate',
  state: MockupState,
  text: string,
) {
  if (response.status === 401) {
    useMockupStore.getState().clear()
    return false
  }
  if (!response.ok)
    throw new Error(result.error || 'Request failed. Please try again.')
  const messages = [
    ...state.messages,
    ...(text ? [{ role: 'user' as const, text }] : []),
  ].slice(-80)
  const { update } = useMockupStore.getState()
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
    const next = nextQuestion(result.intake)
    update({
      intake: result.intake,
      summary: result.summary || null,
      brand: result.brand || null,
      messages: [
        ...messages,
        {
          role: 'assistant',
          text: next
            ? questions[next]
            : 'Here’s your brief. Edit anything you need, then choose Generate mockup.',
        },
      ],
    })
  }
  return true
}

export function ArtMockupWizard() {
  const { state, sessionKey, epoch, start } = useMockupStore()
  useEffect(() => {
    if (sessionKey && !state.started)
      start({ ...useFormStore.getState().getFormData() })
  }, [sessionKey, state.started, start])
  return <MockupConversation key={epoch} />
}

function MockupConversation() {
  const { state, sessionKey, busy: isPending, start } = useMockupStore()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
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
    useMockupStore.setState({ busy: true })
    setError('')
    try {
      const response = await fetch(`/api/mockup/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(kind, state, text)),
      })
      const result = await response.json()
      if (useMockupStore.getState().epoch !== started) return
      if (applyResponse(response, result, kind, state, text)) setDraft('')
    } catch (err) {
      if (useMockupStore.getState().epoch === started)
        setError(
          err instanceof Error
            ? err.message
            : 'Request failed. Please try again.',
        )
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
          <RotateCcw className="size-4" />
          Start Mockup
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {!state.messages.length && (
            <MockupIntro step={step} question={question} />
          )}
          <div
            role="log"
            aria-label="Mockup conversation"
            aria-live="polite"
            className="space-y-5"
          >
            {state.messages.map((message, index) => (
              <div
                key={index}
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
                    <Download className="size-4" />
                    Download selected mockup
                  </a>
                </Button>
              </div>
              {state.attachmentFailed && (
                <p role="status" className="text-sm">
                  Lead created; image could not be attached. Download the
                  selected mockup. Do not resubmit the Lead Form—it would create
                  another lead.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Submit the Lead Form to create a new Nutshell lead with this
                selected image. The advertiser must match. Images cannot be
                added to existing leads from the wizard.
              </p>
            </figure>
          )}
          <MockupFeedback error={error} />
          <div ref={end} />
        </div>
      </div>
      <MockupComposer draft={draft} setDraft={setDraft} send={send} />
    </section>
  )
}

function MockupIntro({
  step,
  question,
}: {
  step: number
  question: Question | undefined
}) {
  const { start, busy: isPending } = useMockupStore()
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

function MockupFeedback({ error }: { error: string }) {
  const { state, busy: isPending, storageWarning } = useMockupStore()
  return (
    <>
      {isPending && (
        <p
          role="status"
          className="animate-pulse text-sm text-muted-foreground"
        >
          {state.summary
            ? 'Rendering your billboard. This can take a couple of minutes. Your current image stays selected.'
            : 'Reading your answer and preparing the next step…'}
        </p>
      )}
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
    </>
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
  const { state, sessionKey, busy: isPending } = useMockupStore()
  return (
    <footer className="border-t bg-background px-4 py-3 sm:px-6">
      <form
        className="mx-auto max-w-3xl space-y-2"
        aria-busy={isPending}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <Label htmlFor="mockup-message" className="sr-only">
          {state.image ? 'Revision instructions' : 'Your answer'}
        </Label>
        <div className="flex items-end gap-2 rounded-xl border p-2">
          <Textarea
            id="mockup-message"
            value={draft}
            disabled={isPending || !sessionKey}
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
            disabled={!draft.trim() || isPending || !sessionKey}
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </Button>
        </div>
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
