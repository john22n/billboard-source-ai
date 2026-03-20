import { NextResponse } from 'next/server'
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

export async function POST() {
  try {
    const session = await getSession()
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const nutshellApiKey = process.env.NUTSHELL_API_KEY
    if (!nutshellApiKey) {
      return NextResponse.json(
        { error: 'Nutshell integration not configured' },
        { status: 500 },
      )
    }

    const credentials = Buffer.from(
      `sky@billboardsource.com:${nutshellApiKey}`,
    ).toString('base64')

    // Get the "Call (GPP2)" source ID so we only sync leads from that source
    const sourceResult = await nutshellRequest(
      'newSource',
      { name: 'Call (GPP2)' },
      credentials,
    )
    if (sourceResult.error || !sourceResult.result?.id) {
      console.error('Failed to get source:', sourceResult.error)
      return NextResponse.json(
        { error: 'Failed to find "Call (GPP2)" source' },
        { status: 400 },
      )
    }
    const sourceId = Number(sourceResult.result.id)

    // Fetch leads from Nutshell - get recent leads (last 90 days) filtered by source
    const since = new Date()
    since.setDate(since.getDate() - 90)
    const sinceDate = since.toISOString().split('T')[0]

    // Nutshell API caps findLeads at 100 per page, so paginate
    const leads: NutshellLead[] = []
    let page = 1
    while (true) {
      const findResult = await nutshellRequest(
        'findLeads',
        {
          query: {
            modifiedTime: `> ${sinceDate}`,
            sourceId,
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
        console.error('Nutshell findLeads error:', findResult.error)
        return NextResponse.json(
          { error: findResult.error.message || 'Failed to fetch leads' },
          { status: 400 },
        )
      }

      const pageLeads: NutshellLead[] = findResult.result || []
      leads.push(...pageLeads)

      if (pageLeads.length < 100) break
      page++
    }

    let synced = 0
    let errors = 0

    // Fetch full details for each lead and upsert
    for (const lead of leads) {
      try {
        // Get full lead details (findLeads may return stubs)
        const detailResult = await nutshellRequest(
          'getLead',
          {
            leadId: lead.id,
          },
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
          closedAt: fullLead.closedTime ? new Date(fullLead.closedTime) : null,
        })
        synced++
      } catch (err) {
        console.error(`Failed to sync lead ${lead.id}:`, err)
        errors++
      }
    }

    return NextResponse.json({
      success: true,
      totalFound: leads.length,
      synced,
      errors,
    })
  } catch (error) {
    console.error('Error syncing Nutshell leads:', error)
    return NextResponse.json({ error: 'Failed to sync leads' }, { status: 500 })
  }
}
