import { getSession } from '@/lib/auth'
import { upsertNutshellLead } from '@/lib/dal'

interface NutshellLead {
  id: number
  description?: string
  status?: number
  value?: { amount?: number; currency?: string }
  closedTime?: string
  createdTime?: string
  assignee?: { emails?: string[] }
}

async function nutshellRequest(
  method: string,
  params: Record<string, unknown>,
  credentials: string,
) {
  const response = await fetch('https://app.nutshell.com/api/v1/json', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: `${method}-${Date.now()}`,
    }),
  })
  return response.json()
}

const CONCURRENCY = 10

async function processInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

export async function POST() {
  try {
    const session = await getSession()
    if (!session || session.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const nutshellApiKey = process.env.NUTSHELL_API_KEY
    if (!nutshellApiKey) {
      return new Response(
        JSON.stringify({ error: 'Nutshell integration not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const credentials = Buffer.from(
      `sky@billboardsource.com:${nutshellApiKey}`,
    ).toString('base64')

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          )
        }

        try {
          send({ type: 'status', message: 'Finding lead source...' })

          // Get the "Call (GPP2)" source ID
          const sourceResult = await nutshellRequest(
            'newSource',
            { name: 'Call (GPP2)' },
            credentials,
          )
          if (sourceResult.error || !sourceResult.result?.id) {
            send({
              type: 'error',
              message: 'Failed to find "Call (GPP2)" source',
            })
            controller.close()
            return
          }
          const sourceId = Number(sourceResult.result.id)

          send({ type: 'status', message: 'Fetching leads from Nutshell...' })

          // Fetch leads with pagination
          const since = new Date()
          since.setDate(since.getDate() - 90)
          const sinceDate = since.toISOString().split('T')[0]

          const leads: NutshellLead[] = []
          let page = 1
          while (true) {
            const findResult = await nutshellRequest(
              'findLeads',
              {
                query: {
                  modifiedTime: `> ${sinceDate}`,
                  source: [sourceId],
                },
                orderBy: 'createdTime',
                orderDirection: 'DESC',
                limit: 100,
                page,
                stubResponses: true,
              },
              credentials,
            )

            if (findResult.error) {
              send({
                type: 'error',
                message: findResult.error.message || 'Failed to fetch leads',
              })
              controller.close()
              return
            }

            const pageLeads: NutshellLead[] = findResult.result || []
            leads.push(...pageLeads)

            if (pageLeads.length < 100) break
            page++
          }

          const total = leads.length
          send({
            type: 'progress',
            message: `Found ${total} leads. Syncing...`,
            total,
            synced: 0,
            errors: 0,
          })

          let synced = 0
          let errors = 0

          // Fetch full details and upsert in concurrent batches
          await processInBatches(
            leads,
            async (lead) => {
              try {
                const detailResult = await nutshellRequest(
                  'getLead',
                  { leadId: lead.id },
                  credentials,
                )

                const fullLead: NutshellLead = detailResult.result || lead
                const valueAmount = fullLead.value?.amount
                  ? String(fullLead.value.amount)
                  : null
                const assigneeEmail = fullLead.assignee?.emails?.[0] ?? null

                await upsertNutshellLead({
                  nutshellLeadId: fullLead.id,
                  description: fullLead.description ?? null,
                  status: fullLead.status ?? 0,
                  value: valueAmount,
                  currency: fullLead.value?.currency ?? 'USD',
                  assigneeEmail,
                  nutshellCreatedAt: fullLead.createdTime
                    ? new Date(fullLead.createdTime)
                    : null,
                  closedAt: fullLead.closedTime
                    ? new Date(fullLead.closedTime)
                    : null,
                })
                synced++
              } catch (err) {
                console.error(`Failed to sync lead ${lead.id}:`, err)
                errors++
              }

              send({ type: 'progress', total, synced, errors })
            },
            CONCURRENCY,
          )

          send({
            type: 'done',
            totalFound: total,
            synced,
            errors,
          })
        } catch (error) {
          console.error('Error syncing Nutshell leads:', error)
          send({ type: 'error', message: 'Failed to sync leads' })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error syncing Nutshell leads:', error)
    return new Response(JSON.stringify({ error: 'Failed to sync leads' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
