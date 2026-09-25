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

export default function ArtWizardTab() {
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null)
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
          Set the instructions used to generate new billboard mockups for all
          reps. Intake, approval summaries, and revision instructions are
          unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            Loading image-generation prompt…
          </p>
        )}
        {savedPrompt !== null && <PromptEditor initialPrompt={savedPrompt} />}
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
          The approved brief and logo instructions are appended automatically.
          Changes apply to new generation requests after saving. Maximum 20,000
          characters.
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
