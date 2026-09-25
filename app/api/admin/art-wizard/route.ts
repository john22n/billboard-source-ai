import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthorizationError } from '@/lib/admin-api'
import {
  defaultSystemPrompt,
  getSystemPrompt,
  resetSystemPrompt,
  saveSystemPrompt,
} from '@/lib/mockup/system-prompt'
import {
  billboardImagePrompt,
  pdfSearchInstructions,
  referenceLabelInstructions,
  toolInstructions,
} from '@/lib/mockup/instructions'

const schema = z
  .object({ prompt: z.string().trim().min(1).max(20_000) })
  .strict()
const headers = { 'Cache-Control': 'private, no-store' }

const instructions = [
  {
    title: 'Tool instructions',
    context:
      'Appended after the editable system prompt on every wizard turn. Describes the two application tools (website review and billboard rendering) and how the wizard must use them.',
    text: toolInstructions,
  },
  {
    title: 'New image frame',
    context:
      'Image API prompt, not a chat message. The wizard writes the creative brief; the application wraps it in this fixed staging frame. The logo sentence depends on whether the website review captured a logo; the reference sentence appears only when a file is attached. Bracketed values are request-time placeholders.',
    text: [
      { label: 'Website logo captured', logo: true, labels: [] },
      {
        label: 'Uploaded reference only',
        logo: false,
        labels: ['[Uploaded file label]'],
      },
      { label: 'No logo or references', logo: false, labels: [] },
    ]
      .map(
        ({ label, logo, labels }) =>
          `${label}\n${billboardImagePrompt('[Creative brief written by the wizard]', { revision: false, logo, labels })}`,
      )
      .join('\n\n'),
  },
  {
    title: 'Revision frame',
    context:
      'Image API prompt. Uses the selected image plus the wizard’s description of the requested changes. The reference sentence appears only when a file is attached.',
    text: billboardImagePrompt('[Requested changes written by the wizard]', {
      revision: true,
      logo: false,
      labels: ['[Uploaded file label]'],
    }),
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
  } catch {
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
          'Only the system prompt can be edited. Enter between 1 and 20,000 characters.',
      },
      { status: 400, headers },
    )
  try {
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
