import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthorizationError } from '@/lib/admin-api'
import {
  getImageGenerationPrompt,
  saveImageGenerationPrompt,
} from '@/lib/mockup/image-prompt'

const schema = z.object({ prompt: z.string().trim().min(1).max(20_000) })
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    return NextResponse.json(
      { prompt: await getImageGenerationPrompt() },
      { headers },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not load the image-generation prompt. Please retry.' },
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
      { error: 'Enter a prompt between 1 and 20,000 characters.' },
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
