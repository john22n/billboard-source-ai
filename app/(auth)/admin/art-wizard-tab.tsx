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

export default function ArtWizardTab() {
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null)
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
          setSavedPrompt(data.prompt)
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
          Inspect the instructions this application sends to OpenAI and
          customize new mockups for all reps. These are application-managed
          instructions, not settings synced from the OpenAI dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {savedPrompt === null && error && (
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
        {savedPrompt === null && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading Creative Studio instructions…
          </p>
        )}
        {savedPrompt !== null && <PromptEditor initialPrompt={savedPrompt} />}
        {savedPrompt !== null && (
          <section
            aria-labelledby="protected-instructions-heading"
            className="space-y-4 border-t pt-6"
          >
            <div className="space-y-2">
              <h3 id="protected-instructions-heading" className="font-semibold">
                Protected workflow instructions
              </h3>
              <p className="text-sm text-muted-foreground">
                Read-only · These instructions share their source with the live
                workflow. They protect questionnaire fields, structured
                responses, and revision behavior. Changing them requires a code
                update and regression tests. Expand a section to read its
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

function PromptEditor({ initialPrompt }: { initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending || !prompt.trim() || prompt.trim() === savedPrompt) return
    setIsPending(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch('/api/admin/art-wizard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Could not save the prompt.')
      setPrompt(data.prompt)
      setSavedPrompt(data.prompt)
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the prompt. Please retry.',
      )
    } finally {
      setIsPending(false)
    }
  }

  let status = ''
  if (saved) status = 'Prompt saved. New mockups will use these instructions.'
  else if (isPending) status = 'Saving prompt…'
  else if (prompt.trim() !== savedPrompt) status = 'Unsaved changes'

  return (
    <form onSubmit={save} className="space-y-4" aria-busy={isPending}>
      <div className="space-y-2">
        <Label htmlFor="image-generation-prompt">
          Image-generation system prompt
        </Label>
        <Textarea
          id="image-generation-prompt"
          aria-describedby="image-prompt-help"
          className="min-h-72 resize-y font-mono leading-relaxed"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value)
            setSaved(false)
          }}
          maxLength={20000}
          required
          disabled={isPending}
        />
        <p id="image-prompt-help" className="text-sm text-muted-foreground">
          Editable · Use this for visual style, composition, and readability.
          The approved brief and protected logo/reference rules are appended
          automatically. Saving affects new generation requests for all reps,
          not questionnaire extraction, summaries, or revisions. Prompt changes
          can still affect image quality; test a new mockup after saving.
          Maximum 20,000 characters.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={
            isPending || !prompt.trim() || prompt.trim() === savedPrompt
          }
        >
          {isPending ? 'Saving…' : 'Save prompt'}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </div>
    </form>
  )
}
