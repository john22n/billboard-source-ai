import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'
import { imageSchema } from '@/lib/mockup/state'
import { attachMockup, searchMockupLeads } from '@/lib/mockup/nutshell'
import { verifyImage } from '@/lib/mockup/receipts'

export const maxDuration = 90

export async function GET(request: Request) {
  const session = await getSession()
  if (!session)
    return NextResponse.json(
      { error: 'Please sign in again.' },
      { status: 401 },
    )
  const q = new URL(request.url).searchParams.get('q')?.trim() || ''
  if (q.length < 2 || q.length > 150)
    return NextResponse.json(
      { error: 'Enter 2–150 characters.' },
      { status: 400 },
    )
  try {
    const credentials = Buffer.from(
      `${session.email}:${serverConfig.nutshell.requireApiKey()}`,
    ).toString('base64')
    return NextResponse.json(
      { leads: await searchMockupLeads(q, credentials, session.email) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { error: 'Could not search Nutshell. Please try again.' },
      { status: 502 },
    )
  }
}

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
      image: imageSchema,
    })
    .safeParse(await request.json())
  if (!input.success || input.data.leadId !== input.data.confirmedLeadId)
    return NextResponse.json(
      { error: 'Confirm the target lead and selected image first.' },
      { status: 400 },
    )
  try {
    await verifyImage(session, input.data.image)
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
