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

    // Fetch leads from Nutshell - get recent leads (last 90 days)
    const since = new Date()
    since.setDate(since.getDate() - 90)

    const findResult = await nutshellRequest(
      'findLeads',
      {
        query: {
          createdAfter: since.toISOString(),
        },
        orderBy: 'createdTime',
        orderDirection: 'DESC',
        limit: 500,
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

    const leads: NutshellLead[] = findResult.result || []
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
