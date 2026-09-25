import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthorizationError } from '@/lib/admin-api'
import {
  getImageGenerationPrompt,
  saveImageGenerationPrompt,
} from '@/lib/mockup/image-prompt'
import { questions } from '@/lib/mockup/intake'
import {
  extractionInstructions,
  summaryInstructions,
  summaryReferenceGuidance,
  newImageInstructions,
  revisionInstructions,
  uploadedInstructions,
  pdfSearchInstructions,
  referenceLabelInstructions,
} from '@/lib/mockup/instructions'

const schema = z
  .object({ prompt: z.string().trim().min(1).max(20_000) })
  .strict()
const headers = { 'Cache-Control': 'private, no-store' }

const instructions = [
  {
    title: 'Questionnaire extraction',
    context:
      'System message. Receives the current intake, current question, questionnaire questions, latest answer, and uploaded references. Structured output is validated in code. Skip answers and exact-copy requests are handled directly by code.',
    text: extractionInstructions,
  },
  {
    title: 'Approval summary',
    context:
      'System message. Receives intake, website evidence, attachment instructions, and references. Returns a validated summary, brand notes, and website-omission flag. The code also preserves website contact copy unless explicitly omitted.',
    text: summaryInstructions,
  },
  {
    title: 'Summary reference guidance',
    context:
      'Included in the approval-summary user message alongside request data.',
    text: summaryReferenceGuidance,
  },
  {
    title: 'New image assembly',
    context:
      'Image API prompt, not a chat system message. The three logo-selection variants are shown below; uploaded-reference instructions are omitted when no uploads are supplied. Bracketed values are request-time placeholders, not customer data. The editable prompt above is inserted first.',
    text: [
      { label: 'Website logo available', logo: true, attachments: true },
      { label: 'Uploaded references only', logo: false, attachments: true },
      { label: 'No logo or references', logo: false, attachments: false },
    ]
      .map(
        ({ label, logo, attachments }) =>
          `${label}\n${newImageInstructions(
            '[Editable image-generation prompt]',
            logo,
            attachments,
            uploadedInstructions(
              attachments ? ['[Uploaded file label]'] : [],
              false,
              logo,
            ),
            Object.fromEntries(
              [
                'advertiser',
                'boardType',
                'market',
                'goal',
                'focus',
                'tone',
                'headline',
                'supporting',
                'contact',
                'direction',
                'caution',
              ].map((key) => [key, `[${key}]`]),
            ),
            '[Website brand notes]',
          )}`,
      )
      .join('\n\n'),
  },
  {
    title: 'Image revisions',
    context:
      'Image API prompt. Uses the selected image and revision request, not the editable initial prompt or original brief. The reference suffix is included only when uploads are supplied.',
    text: revisionInstructions(
      '[Advertiser]',
      '[Revision request]',
      uploadedInstructions(['[Uploaded file label]'], true, false),
    ),
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
      'User-message label sent before each image in intake, summary, and PDF search. PDF labels include the selected page number, page count, and search query when present.',
    text: referenceLabelInstructions('[Filename / PDF page label]'),
  },
  {
    title: 'Questionnaire questions',
    context:
      'Code-owned question order and wording. These fields drive questionnaire progression and extraction; changes require a code update and regression tests.',
    text: Object.entries(questions)
      .map(([field, question]) => `${field}: ${question}`)
      .join('\n\n'),
  },
]

export async function GET() {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    return NextResponse.json(
      { prompt: await getImageGenerationPrompt(), instructions },
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
          'Only the image-generation prompt can be edited. Enter between 1 and 20,000 characters.',
      },
      { status: 400, headers },
    )
  try {
    await saveImageGenerationPrompt(input.data.prompt)
    return NextResponse.json(input.data, { headers })
  } catch {
    return NextResponse.json(
      { error: 'Could not save the prompt. Your edits are preserved; retry.' },
      { status: 500, headers },
    )
  }
}
