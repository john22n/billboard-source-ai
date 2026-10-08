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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  defaultImageSettings,
  imageSettingsSchema,
  type ImageSettings,
} from '@/lib/mockup/image-settings'

type Instruction = { title: string; context: string; text: string }
type Saved = {
  prompt: string
  isDefault: boolean
  imageSettings: ImageSettings
}

function promptLoadError(status: number, apiError?: string) {
  if (status === 401) return 'Your session has expired. Sign in and retry.'
  if (status === 403) return 'Admin access is required to edit the prompt.'
  return apiError || 'Could not load the prompt. Please retry.'
}

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
        const data = await response.json().catch(() => null)
        if (!response.ok)
          throw new Error(promptLoadError(response.status, data?.error))
        if (!controller.signal.aborted) {
          setSaved({
            prompt: data.prompt,
            isDefault: !!data.isDefault,
            imageSettings: data.imageSettings ?? defaultImageSettings,
          })
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
          One design, two outdoor mockups. Both images follow the Mockup Wizard
          system prompt. The poster adapts the bulletin’s design, preserving
          approved copy and brand assets. No format labels or presentation
          footers are added to the images.
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
                rendering, reference handling and output requirements. Changing
                them requires a code update and regression tests. Expand a
                section to read its complete text.
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
  {
    init: (prompt: string, imageSettings: ImageSettings) => RequestInit
    done: string
  }
> = {
  save: {
    init: (prompt, imageSettings) => ({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, imageSettings }),
    }),
    done: 'Settings saved. Subsequent wizard turns will use these instructions.',
  },
  reset: {
    init: () => ({ method: 'DELETE' }),
    done: 'Original system prompt and face ratios restored.',
  },
}

/** Saves or resets the prompt; the server always replies with the prompt now in effect. */
async function submitPrompt(
  action: Action,
  prompt: string,
  imageSettings: ImageSettings,
): Promise<Saved> {
  const response = await fetch(
    '/api/admin/art-wizard',
    actions[action].init(prompt, imageSettings),
  )
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save the prompt.')
  return {
    prompt: data.prompt,
    isDefault: !!data.isDefault,
    imageSettings: data.imageSettings,
  }
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
    : 'Using saved settings.'
}

function PromptEditor({ initial }: { initial: Saved }) {
  const [prompt, setPrompt] = useState(initial.prompt)
  const [imageSettings, setImageSettings] = useState(initial.imageSettings)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')

  async function submit(action: Action) {
    setPending(action)
    setError(null)
    setNotice('')
    try {
      const parsed = imageSettingsSchema.safeParse(imageSettings)
      if (action === 'save' && !parsed.success)
        throw new Error(parsed.error.issues[0].message)
      const next = await submitPrompt(
        action,
        prompt.trim(),
        parsed.success ? parsed.data : defaultImageSettings,
      )
      setPrompt(next.prompt)
      setImageSettings(next.imageSettings)
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

  const dirty =
    prompt.trim() !== saved.prompt ||
    JSON.stringify(imageSettings) !== JSON.stringify(saved.imageSettings)
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
          live here. This is also the creative direction for both generated
          images; only face ratios are configured below. Saving affects
          subsequent turns for all reps, including existing chats; existing
          images are not regenerated. Test a new mockup after saving. Maximum
          20,000 characters.
        </p>
      </div>
      <RatioFields
        value={imageSettings}
        disabled={!!pending}
        onChange={(value) => {
          setImageSettings(value)
          setNotice('')
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!!pending || !prompt.trim() || !dirty}>
          {pending === 'save' ? 'Saving…' : 'Save settings'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!pending || (saved.isDefault && !dirty)}
          onClick={() => void submit('reset')}
        >
          {pending === 'reset' ? 'Restoring…' : 'Reset prompt and ratios'}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </div>
    </form>
  )
}

function RatioFields({
  value,
  disabled,
  onChange,
}: {
  value: ImageSettings
  disabled: boolean
  onChange: (value: ImageSettings) => void
}) {
  return (
    <fieldset disabled={disabled} className="space-y-5 border-t pt-6">
      <legend className="font-semibold">Image generation settings</legend>
      <p className="text-sm text-muted-foreground">
        Creative direction comes from the system prompt above. Only width:height
        ratios change here. Ratios describe the billboard face, not the full
        image including sky and supports. AI follows these proportions
        approximately; these are concept mockups, not dimension-certified print
        files.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['bulletin', 'poster'] as const).map((format) => (
          <fieldset key={format} className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium capitalize">
              {format} face ratio
            </legend>
            <div className="grid grid-cols-2 gap-3">
              {(['width', 'height'] as const).map((axis) => (
                <div key={axis} className="space-y-1">
                  <Label htmlFor={`${format}-${axis}`} className="capitalize">
                    {format} {axis}
                  </Label>
                  <Input
                    id={`${format}-${axis}`}
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    required
                    value={value[format][axis] || ''}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [format]: {
                          ...value[format],
                          [axis]: Number(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </fieldset>
  )
}
