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
import {
  defaultImagePrompts,
  imagePromptsSchema,
  type ImagePrompts,
} from '@/lib/mockup/instructions'

type Instruction = { title: string; context: string; text: string }
type Saved = { prompt: string; isDefault: boolean }

function promptLoadError(status: number, apiError?: string) {
  if (status === 401) return 'Your session has expired. Sign in and retry.'
  if (status === 403) return 'Admin access is required to edit the prompt.'
  return apiError || 'Could not load the prompt. Please retry.'
}

export default function ArtWizardTab() {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [imagePrompts, setImagePrompts] = useState<ImagePrompts | null>(null)
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
        const data = await response.json().catch(() => null)
        if (!response.ok)
          throw new Error(promptLoadError(response.status, data?.error))
        if (!controller.signal.aborted) {
          setSaved({ prompt: data.prompt, isDefault: !!data.isDefault })
          setImagePrompts(data.imagePrompts ?? null)
          setInstructions(data.instructions ?? [])
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load the prompt. Please retry.',
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
          One design, two formats. Manage the wizard’s intake separately from
          the image prompts used to create a bulletin and its matching poster.
          Changes apply to all reps; each group can be reset independently.
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
        {imagePrompts !== null && <ImagePromptEditor initial={imagePrompts} />}
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
                workflow. They connect the wizard to website review, paired
                image rendering, and reference handling. Changing them requires
                a code update and regression tests. Expand a section to read its
                complete text.
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
          with the application’s tool, and renders both formats using the image
          prompts below. Saving affects subsequent turns for all reps; test a
          mockup after saving. Maximum 20,000 characters.
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

const imagePromptLabels: Record<keyof ImagePrompts, string> = {
  bulletin: 'Bulletin image prompt',
  revision: 'Bulletin revision prompt',
  poster: 'Poster adaptation prompt',
}

async function submitImagePrompts(
  prompts: ImagePrompts | null,
): Promise<ImagePrompts> {
  const response = await fetch('/api/admin/art-wizard', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePrompts: prompts }),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error || 'Could not save image prompts.')
  return data.imagePrompts
}

function ImagePromptEditor({ initial }: { initial: ImagePrompts }) {
  const [prompts, setPrompts] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const keys = Object.keys(imagePromptLabels) as (keyof ImagePrompts)[]
  const dirty = keys.some((key) => prompts[key].trim() !== saved[key])
  const isDefault = keys.every((key) => saved[key] === defaultImagePrompts[key])
  const valid = imagePromptsSchema.safeParse(prompts)

  async function submit(value: ImagePrompts | null) {
    setPending(true)
    setError('')
    setNotice('')
    try {
      const next = await submitImagePrompts(value)
      setPrompts(next)
      setSaved(next)
      setNotice(
        value
          ? 'Image prompts saved. The next generation will use them.'
          : 'Original image prompts restored.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save image prompts. Your edits are preserved; retry.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      aria-label="Image generation prompts"
      aria-busy={pending}
      className="space-y-4 border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (!pending && dirty && valid.success) void submit(valid.data)
      }}
    >
      <div className="space-y-2">
        <h3 className="font-semibold">Image generation prompts</h3>
        <p id="image-prompts-help" className="text-sm text-muted-foreground">
          Edit creative direction here. The application requires flat artwork: a
          2304×672 bulletin at 24:7 (48′ × 14′), cropped from 2304×768 at an
          AI-selected vertical position, and a 2496×1152 poster at 13:6 (22′9″ ×
          10′6″), reflowed from the finished bulletin. These output rules
          override conflicting outdoor staging or proportions in saved prompts;
          saved custom text is not automatically changed. Background imagery
          within the advertisement is allowed. Exact ratios do not make the
          images print-ready. Maximum 8,000 characters each.
        </p>
      </div>
      {keys.map((key) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={`image-prompt-${key}`}>
            {imagePromptLabels[key]}
          </Label>
          <Textarea
            id={`image-prompt-${key}`}
            aria-describedby="image-prompts-help"
            className="min-h-40 resize-y font-mono leading-relaxed"
            value={prompts[key]}
            disabled={pending}
            required
            maxLength={8000}
            onChange={(event) => {
              setPrompts({ ...prompts, [key]: event.target.value })
              setNotice('')
            }}
          />
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !dirty || !valid.success}>
          Save image prompts
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || (isDefault && !dirty)}
          onClick={() => void submit(null)}
        >
          Reset image prompts
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {imagePromptStatus({ pending, dirty, notice, isDefault })}
        </p>
      </div>
    </form>
  )
}

function imagePromptStatus(input: {
  pending: boolean
  dirty: boolean
  notice: string
  isDefault: boolean
}) {
  if (input.pending) return 'Saving image prompts…'
  if (input.dirty) return 'Unsaved image prompt changes'
  if (input.notice) return input.notice
  return input.isDefault
    ? 'Using original image prompts.'
    : 'Using customized image prompts.'
}
