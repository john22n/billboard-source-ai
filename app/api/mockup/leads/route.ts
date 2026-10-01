import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { imageSchema } from '@/lib/mockup/state'
import { attachMockup } from '@/lib/mockup/nutshell'
import { verifyArtifact, verifyImage } from '@/lib/mockup/receipts'

export const maxDuration = 90

export async function POST(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const input = z
    .object({
      leadId: z.number().int().positive(),
      confirmedLeadId: z.number().int().positive(),
      receipt: z.string().min(1).max(6000),
      image: imageSchema,
    })
    .safeParse(await request.json().catch(() => null))
  if (!input.success || input.data.leadId !== input.data.confirmedLeadId)
    return NextResponse.json(
      { error: 'Confirm the target lead and selected image first.' },
      { status: 400 },
    )
  try {
    await verifyImage(session, input.data.image)
    await verifyArtifact(
      session,
      'attachment',
      input.data.image.dataUrl,
      input.data.image.advertiser,
      `${input.data.leadId}:${input.data.image.id}`,
      input.data.receipt,
    )
  } catch {
    return NextResponse.json(
      {
        error:
          'Retry only the original image against its created lead. Your download remains available.',
      },
      { status: 400 },
    )
  }
  try {
    const credentials = Buffer.from(
      `${session.email}:${serverConfig.nutshell.requireApiKey()}`,
    ).toString('base64')
    const target = await attachMockup(
      input.data.leadId,
      input.data.image,
      credentials,
    )
    return NextResponse.json({ success: true, target })
  } catch {
    return NextResponse.json(
      {
        error:
          'Image could not be attached. Confirm that this lead’s advertiser matches the mockup, then retry. Your download remains available.',
      },
      { status: 502 },
    )
  }
}
