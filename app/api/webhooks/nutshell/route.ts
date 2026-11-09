import { createHash, timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { z } from 'zod'
import { serverConfig } from '@/lib/config'
import { nutshellWebhookInbox } from '@/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 30

const envelope = z.object({
  events: z
    .array(
      z
        .object({
          payloadType: z.string(),
          action: z.string(),
        })
        .passthrough(),
    )
    .max(1000),
})
const leadCreated = z.object({
  id: z.string().regex(/^[1-9]\d{0,19}-events$/),
  links: z.object({
    payloads: z
      .array(z.string().regex(/^[1-9]\d{0,19}-leads$/))
      .min(1)
      .max(1000),
  }),
})

async function readEnvelope(request: Request) {
  // Bound streamed bodies too; Content-Length is not trustworthy or required.
  const reader = request.body?.getReader()
  if (!reader)
    return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let size = 0
  let parsed: z.infer<typeof envelope>
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1024 * 1024) {
        await reader.cancel()
        return Response.json({ error: 'Payload too large' }, { status: 413 })
      }
      chunks.push(chunk.value)
    }
    parsed = envelope.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    return Response.json({ error: 'Invalid payload' }, { status: 400 })
  } finally {
    reader.releaseLock()
  }
  return parsed
}

function leadReferences(parsed: z.infer<typeof envelope>) {
  const rows: { eventId: string; leadId: string }[] = []
  for (const event of parsed.events) {
    if (event.payloadType !== 'leads' || event.action !== 'create') continue
    const result = leadCreated.safeParse(event)
    if (!result.success)
      return Response.json({ error: 'Invalid lead event' }, { status: 400 })
    for (const leadId of result.data.links.payloads)
      rows.push({ eventId: result.data.id, leadId })
    if (rows.length > 1000)
      return Response.json(
        { error: 'Too many lead references' },
        { status: 413 },
      )
  }
  return rows
}

export async function POST(request: Request) {
  const secret = serverConfig.nutshell.webhookSecret
  if (!secret || secret.length < 32)
    return Response.json({ error: 'Webhook unavailable' }, { status: 503 })

  const tokens = new URL(request.url).searchParams.getAll('token')
  const hash = (value: string) => createHash('sha256').update(value).digest()
  if (tokens.length !== 1 || !timingSafeEqual(hash(tokens[0]), hash(secret)))
    return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readEnvelope(request)
  if (parsed instanceof Response) return parsed
  const rows = leadReferences(parsed)
  if (rows instanceof Response) return rows
  if (!rows.length) return Response.json({ accepted: 0 })

  try {
    const { db } = await import('@/db')
    // One atomic insert: acknowledge only once the entire batch is durable.
    // Store identifiers, not customer data or untrusted embedded URLs/owners.
    const inserted = await db
      .insert(nutshellWebhookInbox)
      .values(rows)
      .onConflictDoNothing()
      .returning()
    if (serverConfig.leadNotifications.enabled) {
      after(async () => {
        try {
          const { processLeadNotifications } =
            await import('@/lib/lead-notifications/processor')
          await processLeadNotifications()
        } catch {
          // Intake remains durable; the protected scheduled retry recovers it.
          console.error('Lead notification processing unavailable')
        }
      })
    }
    return Response.json({ accepted: inserted.length }, { status: 202 })
  } catch {
    // Never log the request URL, token, payload, or a DB error with bind values.
    return Response.json({ error: 'Webhook unavailable' }, { status: 503 })
  }
}
