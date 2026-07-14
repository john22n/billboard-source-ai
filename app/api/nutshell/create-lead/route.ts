import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { upsertNutshellLead } from '@/lib/dal'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'

interface ContactInfo {
  name: string
  position: string
  phone: string
  email: string
}

interface NutshellLeadRequest {
  // Primary contact info (for backwards compatibility)
  name: string
  position: string
  phone: string
  email: string

  // Additional contacts
  additionalContacts?: ContactInfo[]

  // Account/Business info
  entityName: string
  website: string

  // Lead classification
  typeName: string | null
  businessName: string
  leadType: 'Availer' | 'Panel Requester' | 'Tire Kicker' | null

  // Billboard experience
  billboardsBeforeYN: string
  billboardsBeforeDetails: string

  // Campaign details
  billboardPurpose: string
  accomplishDetails: string
  targetAudience: string

  // Location
  targetCity: string
  state: string
  targetArea: string

  // Timeline & preferences
  startMonth: string
  campaignLength: string
  boardType: string

  // Business context
  hasMediaExperience: boolean | string | null
  yearsInBusiness: string

  // Decision making
  decisionMaker: 'alone' | 'partners' | 'boss' | 'committee' | null

  // Notes
  notes: string
  sendOver: string[]

  // Budget
  budget: string

  // Ballpark (rate estimate)
  ballpark: string

  // Transcript
  transcript: string
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

// Retry wrapper — retries up to `retries` times with exponential backoff
async function nutshellRequestWithRetry(
  method: string,
  params: Record<string, unknown>,
  credentials: string,
  retries = 2,
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await nutshellRequest(method, params, credentials)
      if (!result.error) return result
      // If Nutshell returned a JSON error (not a network failure), don't retry
      if (attempt === retries) return result
    } catch (err) {
      if (attempt === retries) throw err
      // Wait 1s on first retry, 2s on second
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
      console.warn(`Retrying ${method} (attempt ${attempt + 1})...`)
    }
  }
}

function validationError(data: NutshellLeadRequest) {
  const missingFields = [
    !data.name?.trim() && 'Name',
    !data.entityName?.trim() && 'Company Name',
    !data.phone?.trim() && 'Phone',
    !data.email?.trim() && 'Email',
  ].filter(Boolean) as string[]
  return missingFields.length
    ? NextResponse.json(
        { error: 'Missing required fields', missingFields },
        { status: 400 },
      )
    : null
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUrl(url: string) {
  if (['no', 'yes', 'n/a', 'none'].includes(url.toLowerCase())) return false
  try {
    new URL(url.startsWith('http') ? url : `https://${url}`)
    return true
  } catch {
    return false
  }
}

async function resolveNutshellUser(userEmail: string, credentials: string) {
  const result = await nutshellRequest(
    'findUsers',
    { query: { email: userEmail } },
    credentials,
  )
  if (result.error) {
    return {
      error: NextResponse.json(
        { error: result.error.message || 'Failed to find user in Nutshell' },
        { status: 400 },
      ),
    }
  }
  const user = (result.result || []).find((candidate: { emails?: string[] }) =>
    candidate.emails?.some(
      (email) => email.toLowerCase() === userEmail.toLowerCase(),
    ),
  )
  return user?.id
    ? { id: Number(user.id) }
    : {
        error: NextResponse.json(
          { error: `No Nutshell user found for email: ${userEmail}` },
          { status: 400 },
        ),
      }
}

async function findOrCreateAccount(
  data: NutshellLeadRequest,
  credentials: string,
) {
  if (!data.entityName?.trim()) return null
  const name = data.entityName.trim()
  const search = await nutshellRequest(
    'searchUniversal',
    { string: name },
    credentials,
  )
  const found = search.result?.accounts?.find(
    (account: { name?: string }) =>
      account.name?.toLowerCase() === name.toLowerCase(),
  )
  if (found?.id) return Number(found.id)
  const account: Record<string, unknown> = { name }
  if (data.website?.trim() && isValidUrl(data.website.trim())) {
    const url = data.website.trim()
    account.url = [url.startsWith('http') ? url : `https://${url}`]
  }
  const result = await nutshellRequest('newAccount', { account }, credentials)
  if (result.result?.id) return Number(result.result.id)
  if (result.error) console.error('Failed to create account:', result.error)
  return null
}

function contactPayload(contact: ContactInfo, validEmail: string | null) {
  const payload: Record<string, unknown> = {}
  if (contact.name?.trim()) payload.name = contact.name.trim()
  if (contact.position?.trim()) payload.description = contact.position.trim()
  if (contact.phone?.trim()) payload.phone = [contact.phone.trim()]
  if (validEmail) payload.email = [validEmail]
  return payload
}

async function updateContact(
  contactId: number,
  contact: ContactInfo,
  validEmail: string | null,
  accountId: number | null,
  credentials: string,
) {
  const result = await nutshellRequest('getContact', { contactId }, credentials)
  if (!result.result) return
  const currentAccounts = result.result.accounts || []
  const accounts = currentAccounts.map((account: { id?: number }) => ({
    id: account.id,
  }))
  if (
    !currentAccounts.some(
      (account: { id?: number }) => Number(account.id) === accountId,
    ) &&
    accountId &&
    accountId > 0
  ) {
    accounts.push({ id: accountId })
  }
  await nutshellRequest(
    'editContact',
    {
      contactId,
      rev: result.result.rev,
      contact: { accounts, ...contactPayload(contact, validEmail) },
    },
    credentials,
  )
}

async function findOrCreateContact(
  contact: ContactInfo,
  accountId: number | null,
  credentials: string,
): Promise<number | null> {
  const email = contact.email?.trim()
  const validEmail = email && isValidEmail(email) ? email : null
  if (!(contact.name?.trim() || contact.phone?.trim() || validEmail))
    return null
  if (validEmail) {
    const search = await nutshellRequest(
      'searchByEmail',
      { emailAddressString: validEmail },
      credentials,
    )
    const contactId = search.result?.contacts?.[0]?.id
    if (contactId) {
      const id = Number(contactId)
      await updateContact(id, contact, validEmail, accountId, credentials)
      return id
    }
  }
  const payload = contactPayload(contact, validEmail)
  if (accountId && accountId > 0) payload.accounts = [{ id: accountId }]
  const result = await nutshellRequest(
    'newContact',
    { contact: payload },
    credentials,
  )
  if (result.result?.id) return Number(result.result.id)
  if (result.error) console.error('Failed to create contact:', result.error)
  return null
}

async function resolveContacts(
  data: NutshellLeadRequest,
  accountId: number | null,
  credentials: string,
) {
  const contacts: ContactInfo[] = [
    {
      name: data.name,
      position: data.position,
      phone: data.phone,
      email: data.email,
    },
    ...(data.additionalContacts || []),
  ]
  const ids: number[] = []
  for (const contact of contacts) {
    const id = await findOrCreateContact(contact, accountId, credentials)
    if (id && id > 0) ids.push(id)
  }
  return ids
}

function buildTags(data: NutshellLeadRequest) {
  const tags: string[] = []
  const typeRules: [RegExp, string][] = [
    [/\b(est\.?|established)\s*b2b\b/i, 'Type: Established B2B'],
    [/\b(est\.?|established)\s*b2c\b/i, 'Type: Established B2C'],
    [/\bnew\s*b2b\b/i, 'Type: New B2B'],
    [/\bnew\s*b2c\b/i, 'Type: New B2C'],
    [/\bpolit/i, 'Type: Political'],
    [/\b(non-?profit|nonprofit)\b/i, 'Type: Non-Profit'],
    [/\bpersonal\b/i, 'Type: Personal'],
  ]
  if (data.typeName) {
    const match = typeRules.find(([pattern]) =>
      pattern.test(data.typeName!.toLowerCase()),
    )
    if (match) tags.push(match[1])
  }
  const goals: [string, string][] = [
    ['directional', 'Goal: Directional'],
    ['enrollment', 'Goal: Enrollment'],
    ['event', 'Goal: Event'],
    ['brand awareness', 'Goal: General Brand Awareness'],
    ['awareness', 'Goal: General Brand Awareness'],
    ['hiring', 'Goal: Hiring'],
    ['new location', 'Goal: New Location'],
    ['location', 'Goal: New Location'],
    ['new product', 'Goal: New Product/Service'],
    ['product', 'Goal: New Product/Service'],
    ['service', 'Goal: New Product/Service'],
    ['political', 'Goal: Political'],
    ['calls', 'Goal: Calls'],
  ]
  if (data.billboardPurpose) {
    const match = goals.find(([key]) =>
      data.billboardPurpose.toLowerCase().includes(key),
    )
    if (match) tags.push(match[1])
  }
  const request = {
    Availer: 'Request: Availer',
    'Panel Requester': 'Request: Panel Requestor',
    'Tire Kicker': 'Request: Tire-Kicker',
  }
  const decision = {
    alone: 'Decision: Decision Maker',
    boss: 'Decision: Middle Person',
    partners: 'Decision: Group (Co-Owners)',
    committee: 'Decision: Group (Committee or Team)',
  }
  if (data.leadType && request[data.leadType]) {
    tags.push(request[data.leadType])
  }
  if (data.decisionMaker && decision[data.decisionMaker]) {
    tags.push(decision[data.decisionMaker])
  }
  return tags
}

async function resolvePipeline(credentials: string) {
  const stagesets = await nutshellRequest('findStagesets', {}, credentials)
  const pipeline = stagesets.result?.find(
    (item: { name?: string }) => item.name === 'NEW BSI Pipeline',
  )
  if (!pipeline?.id) return {}
  const stagesetId = Number(pipeline.id)
  const milestones = await nutshellRequest('findMilestones', {}, credentials)
  const milestone = milestones.result
    ?.filter((item: { stagesetId?: number }) => item.stagesetId === stagesetId)
    .find((item: { name?: string }) => item.name === 'Qualify')
  return {
    stagesetId,
    milestoneId: milestone?.id ? Number(milestone.id) : undefined,
  }
}

function addMappedCustomFields(
  fields: Record<string, string>,
  data: NutshellLeadRequest,
) {
  const mappings: [keyof NutshellLeadRequest, string][] = [
    ['boardType', 'OOH Type of Interest'],
    ['budget', 'Budget'],
    ['ballpark', 'Rate Estimate'],
    ['yearsInBusiness', 'Business Age'],
    ['targetAudience', 'Consumer Target'],
    ['notes', 'Notes:'],
  ]
  for (const [key, label] of mappings)
    if (data[key]) fields[label] = String(data[key])
}

function buildCustomFields(data: NutshellLeadRequest) {
  const fields: Record<string, string> = {}
  if (data.billboardsBeforeYN)
    fields['OOH Experience'] =
      data.billboardsBeforeYN === 'Y'
        ? `Yes${data.billboardsBeforeDetails ? ` - ${data.billboardsBeforeDetails}` : ''}`
        : 'No'
  const location = [
    data.targetCity,
    data.state,
    data.targetArea ? `- ${data.targetArea}` : '',
  ].filter(Boolean)
  if (location.length)
    fields['Target Market(s) - City/State/Area'] = location.join(', ')
  if (data.startMonth) fields['Potential Start Date?'] = data.startMonth
  const length = Array.isArray(data.campaignLength)
    ? data.campaignLength[0]
    : data.campaignLength
  if (length) fields['Contract Length?'] = String(length)
  addMappedCustomFields(fields, data)
  if (data.hasMediaExperience !== null && data.hasMediaExperience !== '')
    fields['Other Ads'] = String(data.hasMediaExperience).trim()
  if (data.sendOver?.length)
    fields['Promised Deliverables'] = data.sendOver.join(', ')
  return fields
}

function buildNote(data: NutshellLeadRequest) {
  const parts: string[] = []
  if (data.accomplishDetails) parts.push(`Goals: ${data.accomplishDetails}`)
  if (data.targetAudience) parts.push(`Target Audience: ${data.targetAudience}`)
  if (data.hasMediaExperience !== null && data.hasMediaExperience !== '')
    parts.push(`Other Advertising: ${String(data.hasMediaExperience).trim()}`)
  if (data.yearsInBusiness)
    parts.push(`Years in Business: ${data.yearsInBusiness}`)
  if (data.website) parts.push('Has Website: Yes')
  if (data.sendOver?.length) parts.push(`Sending: ${data.sendOver.join(', ')}`)
  if (data.transcript?.trim())
    parts.push('', '--- CALL TRANSCRIPT ---', '', data.transcript.trim())
  return parts
}

async function resolveSource(credentials: string) {
  const result = await nutshellRequest(
    'newSource',
    { name: 'Call (GPP2)' },
    credentials,
  )
  if (result.result?.id) return Number(result.result.id)
  if (result.error) console.error('Failed to get/create source:', result.error)
  return null
}

function buildLeadPayload(options: {
  data: NutshellLeadRequest
  userId: number
  contactIds: number[]
  accountId: number | null
  tags: string[]
  stagesetId?: number
  milestoneId?: number
  sourceId: number | null
  customFields: Record<string, string>
}) {
  const {
    data,
    userId,
    contactIds,
    accountId,
    tags,
    stagesetId,
    milestoneId,
    sourceId,
    customFields,
  } = options
  const description =
    data.entityName?.trim() || data.name?.trim() || 'Billboard Lead'
  const lead: Record<string, unknown> = {
    description,
    assignee: { entityType: 'Users', id: userId },
  }
  if (contactIds.length) lead.contacts = contactIds.map((id) => ({ id }))
  if (accountId && accountId > 0) lead.accounts = [{ id: accountId }]
  if (tags.length) lead.tags = tags
  if (stagesetId && stagesetId > 0) lead.stagesetId = stagesetId
  if (milestoneId && milestoneId > 0) lead.milestoneId = milestoneId
  if (sourceId && sourceId > 0) lead.sources = [{ id: sourceId }]
  if (Object.keys(customFields).length) lead.customFields = customFields
  return { lead, description }
}

async function createLeadAndPersist(options: {
  lead: Record<string, unknown>
  description: string
  noteParts: string[]
  credentials: string
  userEmail: string
  createdByUserId: string
  contactIds: number[]
  accountId: number | null
}) {
  const {
    lead,
    description,
    noteParts,
    credentials,
    userEmail,
    createdByUserId,
    contactIds,
    accountId,
  } = options
  console.log(
    'Creating Nutshell lead with payload:',
    JSON.stringify(lead, null, 2),
  )
  const result = await nutshellRequestWithRetry(
    'newLead',
    { lead },
    credentials,
  )
  if (result?.error) {
    console.error('Nutshell newLead error:', result.error)
    return NextResponse.json(
      { error: result.error.message || 'Failed to create lead in Nutshell' },
      { status: 400 },
    )
  }
  const leadId = result?.result?.id
  if (leadId && noteParts.length) {
    try {
      await nutshellRequest(
        'newNote',
        {
          entity: { id: leadId, entityType: 'Leads' },
          note: noteParts.join('\n'),
        },
        credentials,
      )
    } catch (noteError) {
      console.error('Failed to post note to Nutshell lead:', noteError)
    }
  }
  if (leadId) {
    try {
      await upsertNutshellLead({
        nutshellLeadId: Number(leadId),
        description,
        status: 0,
        assigneeEmail: userEmail,
        createdByUserId,
        nutshellCreatedAt: new Date(),
      })
    } catch (dbError) {
      console.error('Failed to save lead to local DB:', dbError)
    }
  }
  return NextResponse.json({
    success: true,
    leadId,
    contactIds,
    accountId,
    message: 'Lead created successfully in Nutshell',
  })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userEmail = session.email
    const data: NutshellLeadRequest = await req.json()
    const invalid = validationError(data)
    if (invalid) return invalid

    console.log('Nutshell form submitted:', {
      submittedBy: userEmail,
      formData: data,
    })
    let apiKey: string
    try {
      apiKey = serverConfig.nutshell.requireApiKey()
    } catch (error) {
      if (!isMissingConfig(error)) throw error
      return NextResponse.json(configErrorResponseBody(error), { status: 500 })
    }
    const credentials = Buffer.from(`${userEmail}:${apiKey}`).toString('base64')
    const user = await resolveNutshellUser(userEmail, credentials)
    if (user.error) return user.error

    const accountId = await findOrCreateAccount(data, credentials)
    const contactIds = await resolveContacts(data, accountId, credentials)
    const tags = buildTags(data)
    const pipeline = await resolvePipeline(credentials)
    const customFields = buildCustomFields(data)
    const noteParts = buildNote(data)
    const sourceId = await resolveSource(credentials)
    const { lead, description } = buildLeadPayload({
      data,
      userId: user.id!,
      contactIds,
      accountId,
      tags,
      ...pipeline,
      sourceId,
      customFields,
    })
    return await createLeadAndPersist({
      lead,
      description,
      noteParts,
      credentials,
      userEmail,
      createdByUserId: session.userId,
      contactIds,
      accountId,
    })
  } catch (error) {
    console.error('Error creating Nutshell lead:', error)
    return NextResponse.json(
      { error: 'Failed to create lead in Nutshell' },
      { status: 500 },
    )
  }
}
