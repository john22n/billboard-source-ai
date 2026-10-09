import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthorizationError } from '@/lib/admin-api'
import {
  defaultSystemPrompt,
  getSystemPrompt,
  resetSystemPrompt,
  saveImagePrompts,
  saveSystemPrompt,
} from '@/lib/mockup/system-prompt'
import {
  defaultImagePrompts,
  imagePromptsSchema,
  pdfSearchInstructions,
  referenceLabelInstructions,
  toolInstructions,
} from '@/lib/mockup/instructions'

const schema = z.union([
  z.object({ prompt: z.string().trim().min(1).max(20_000) }).strict(),
  z.object({ imagePrompts: imagePromptsSchema.nullable() }).strict(),
])
const headers = { 'Cache-Control': 'private, no-store' }

const instructions = [
  {
    title: 'Tool instructions',
    context:
      'Appended after the editable system prompt on every wizard turn. Describes the two application tools (website review and billboard rendering) and how the wizard must use them.',
    text: toolInstructions,
  },
  {
    title: 'PDF search',
    context:
      'System message. Receives the search query and every PDF page image. The returned page number is validated before selecting a reference.',
    text: pdfSearchInstructions,
  },
  {
    title: 'Attachment handling',
    context:
      'Label sent before each uploaded image in the wizard conversation and PDF search. PDF labels include the selected page number, page count, and search query when present.',
    text: referenceLabelInstructions('[Filename / PDF page label]'),
  },
]

export async function GET() {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    return NextResponse.json(
      { ...(await getSystemPrompt()), instructions },
      { headers },
    )
  } catch (error) {
    console.error('Failed to load Creative Studio instructions', error)
    return NextResponse.json(
      { error: 'Could not load Creative Studio instructions. Please retry.' },
      { status: 500, headers },
    )
  }
}

export async function PUT(request: Request) {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  const input = schema.safeParse(await request.json().catch(() => null))
  if (!input.success)
    return NextResponse.json(
      {
        error:
          'Enter a system prompt of 1–20,000 characters or all three image prompts of 1–8,000 characters each. Protected instructions cannot be edited.',
      },
      { status: 400, headers },
    )
  try {
    if ('imagePrompts' in input.data) {
      await saveImagePrompts(input.data.imagePrompts)
      return NextResponse.json(
        { imagePrompts: input.data.imagePrompts ?? defaultImagePrompts },
        { headers },
      )
    }
    await saveSystemPrompt(input.data.prompt)
    return NextResponse.json(
      {
        prompt: input.data.prompt,
        isDefault: input.data.prompt === defaultSystemPrompt,
      },
      { headers },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not save the prompt. Your edits are preserved; retry.' },
      { status: 500, headers },
    )
  }
}

/** One-click full reset to the original Billboard Source Mockup Wizard prompt. */
export async function DELETE() {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    await resetSystemPrompt()
    return NextResponse.json(
      { prompt: defaultSystemPrompt, isDefault: true },
      { headers },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not reset the prompt. Please retry.' },
      { status: 500, headers },
    )
  }
}
