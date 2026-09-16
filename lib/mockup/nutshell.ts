import { sameAdvertiser, type LeadTarget, type MockupImage } from './intake'

type NutshellFile = {
  id?: number
  entityType: string
  name: string
  uri?: string
  size?: number
}
type NutshellLead = {
  id: number
  name?: string
  description?: string
  rev: string
  primaryAccount?: { name: string }
  primaryAccountName?: string
  file?: NutshellFile[]
}

export async function mockupNutshellRequest<T>(
  method: string,
  params: Record<string, unknown>,
  credentials: string,
): Promise<T> {
  const response = await fetch('https://app.nutshell.com/api/v1/json', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
    redirect: 'error',
  })
  const body = await response.json()
  if (!response.ok || body.error || !body.result)
    throw new Error('Nutshell request failed.')
  return body.result as T
}

export function leadTarget(lead: NutshellLead): LeadTarget {
  return {
    id: Number(lead.id),
    name: lead.description || lead.name || `Lead ${lead.id}`,
    advertiser:
      lead.primaryAccount?.name ||
      lead.primaryAccountName ||
      lead.description ||
      '',
  }
}

export async function searchMockupLeads(query: string, credentials: string) {
  const result = await mockupNutshellRequest<{
    leads?: NutshellLead[]
    accounts?: { id: number }[]
  }>('searchUniversal', { string: query }, credentials)
  const companyLeads = await Promise.all(
    (result.accounts || [])
      .slice(0, 5)
      .map((account) =>
        mockupNutshellRequest<NutshellLead[]>(
          'findLeads',
          { query: { accountId: account.id }, limit: 20, stubResponses: true },
          credentials,
        ),
      ),
  )
  return [
    ...new Map(
      [...(result.leads || []), ...companyLeads.flat()].map((lead) => [
        Number(lead.id),
        leadTarget(lead),
      ]),
    ).values(),
  ].slice(0, 20)
}

/** Retry the same deterministic filename, retaining ALL existing lead files. No newLead call here. */
export async function attachMockup(
  leadId: number,
  image: MockupImage,
  credentials: string,
) {
  let lead = await mockupNutshellRequest<NutshellLead>(
    'getLead',
    { leadId },
    credentials,
  )
  const target = leadTarget(lead)
  if (!sameAdvertiser(target.advertiser, image.advertiser))
    throw new Error(
      'The lead’s advertiser does not match this mockup. Select the matching lead instead.',
    )
  const name = `billboard-concept-${image.id}.jpg`
  let file = lead.file?.find((item) => item.name === name)
  if (file?.size) return target
  if (!file) {
    lead = await mockupNutshellRequest<NutshellLead>(
      'editLead',
      {
        leadId,
        rev: lead.rev,
        lead: { file: [...(lead.file || []), { entityType: 'Files', name }] },
      },
      credentials,
    )
    file = lead.file?.find((item) => item.name === name)
  }
  if (!file?.uri)
    throw new Error('Nutshell did not provide an upload destination.')
  const url = new URL(file.uri)
  // Never leak CRM credentials to a redirect or arbitrary upload host.
  if (
    url.origin !== 'https://app.nutshell.com' ||
    !/^\/file\/api\/\d+$/.test(url.pathname) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid Nutshell upload destination.')
  const form = new FormData()
  form.append(
    'file',
    new Blob([Buffer.from(image.dataUrl.split(',')[1], 'base64')], {
      type: 'image/jpeg',
    }),
    name,
  )
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error('Nutshell image upload failed.')
  return target
}
