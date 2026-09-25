'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Instruction = { title: string; context: string; text: string }
type Saved = { prompt: string; isDefault: boolean }

export default function ArtWizardTab() {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [instructions, setInstructions] = useState<Instruction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch('/api/admin/art-wizard', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error('Could not load the prompt. Please retry.')
        const data = await response.json()
        if (!controller.signal.aborted) {
          setSaved({ prompt: data.prompt, isDefault: !!data.isDefault })
          setInstructions(data.instructions ?? [])
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            'Could not load the prompt. Check your admin access and retry.',
          )
      }
    }
    void load()
    return () => controller.abort()
  }, [retry])

  return (
    <Card className="py-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Creative Studio</h2>
        <CardDescription>
          The Mockup Wizard runs on one system prompt, exactly like a ChatGPT
          project. Edit it here for all reps, or reset to the original prompt in
          one click. The application appends the protected tool and image frames
          shown below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {saved === null && error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setError(null)
                setRetry(retry + 1)
              }}
            >
              Retry loading
            </Button>
          </div>
        )}
        {saved === null && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading Creative Studio instructions…
          </p>
        )}
        {saved !== null && <PromptEditor initial={saved} />}
        {saved !== null && (
          <section
            aria-labelledby="protected-instructions-heading"
            className="space-y-4 border-t pt-6"
          >
            <div className="space-y-2">
              <h3 id="protected-instructions-heading" className="font-semibold">
                Protected instructions
              </h3>
              <p className="text-sm text-muted-foreground">
                Read-only · These frames share their source with the live
                workflow. They connect the wizard to website review and image
                rendering and keep every mockup on a realistic billboard.
                Changing them requires a code update and regression tests.
                Expand a section to read its complete text.
              </p>
            </div>
            <div className="divide-y rounded-lg border">
              {instructions.map((instruction) => (
                <details key={instruction.title} className="group p-4">
                  <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">
                    {instruction.title}
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {instruction.context}
                  </p>
                  <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
                    {instruction.text}
                  </pre>
                </details>
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}

type Action = 'save' | 'reset'

const actions: Record<
  Action,
  { init: (prompt: string) => RequestInit; done: string }
> = {
  save: {
    init: (prompt) => ({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }),
    done: 'Prompt saved. New wizard conversations will use these instructions.',
  },
  reset: {
    init: () => ({ method: 'DELETE' }),
    done: 'Original prompt restored. New wizard conversations will use it.',
  },
}

/** Saves or resets the prompt; the server always replies with the prompt now in effect. */
async function submitPrompt(action: Action, prompt: string): Promise<Saved> {
  const response = await fetch(
    '/api/admin/art-wizard',
    actions[action].init(prompt),
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save the prompt.')
  return { prompt: data.prompt, isDefault: !!data.isDefault }
}

function statusText(input: {
  pending: Action | null
  dirty: boolean
  notice: string
  isDefault: boolean
}) {
  if (input.pending === 'save') return 'Saving prompt…'
  if (input.pending === 'reset') return 'Restoring the original prompt…'
  if (input.dirty) return 'Unsaved changes'
  if (input.notice) return input.notice
  return input.isDefault
    ? 'Using the original prompt.'
    : 'Using a customized prompt.'
}

function PromptEditor({ initial }: { initial: Saved }) {
  const [prompt, setPrompt] = useState(initial.prompt)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')

  async function submit(action: Action) {
    setPending(action)
    setError(null)
    setNotice('')
    try {
      const next = await submitPrompt(action, prompt.trim())
      setPrompt(next.prompt)
      setSaved(next)
      setNotice(actions[action].done)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the prompt. Please retry.',
      )
    } finally {
      setPending(null)
    }
  }

  const dirty = prompt.trim() !== saved.prompt
  const status = statusText({
    pending,
    dirty,
    notice,
    isDefault: saved.isDefault,
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!pending && prompt.trim() && dirty) void submit('save')
      }}
      className="space-y-4"
      aria-busy={!!pending}
    >
      <div className="space-y-2">
        <Label htmlFor="wizard-system-prompt">
          Mockup Wizard system prompt
        </Label>
        <Textarea
          id="wizard-system-prompt"
          aria-describedby="wizard-prompt-help"
          className="min-h-96 resize-y font-mono leading-relaxed"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value)
            setNotice('')
          }}
          maxLength={20000}
          required
          disabled={!!pending}
        />
        <p id="wizard-prompt-help" className="text-sm text-muted-foreground">
          Editable · Questions, order, design rules, tone and reset behavior all
          live here. The wizard asks these questions itself, reviews the website
          with the application’s tool, and renders the image through the
          protected frames below. Saving affects new conversations for all reps;
          test a mockup after saving. Maximum 20,000 characters.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!!pending || !prompt.trim() || !dirty}>
          {pending === 'save' ? 'Saving…' : 'Save prompt'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!pending || (saved.isDefault && !dirty)}
          onClick={() => void submit('reset')}
        >
          {pending === 'reset' ? 'Restoring…' : 'Reset to original prompt'}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </div>
    </form>
  )
}
