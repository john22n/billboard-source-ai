import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'

const id = z
  .string()
  .max(80)
  .regex(/^[1-9]\d{0,19}-[a-zA-Z][a-zA-Z0-9]*$/)
const seconds = z.number().int().positive().max(253402300799)
const leadResponse = z.object({
  leads: z.array(
    z.object({
      id,
      name: z.string().max(2000),
      htmlUrl: z.string().url(),
      createdTime: z.object({ timestamp: seconds }),
      links: z.object({ sources: z.array(id), accounts: z.array(id) }),
    }),
  ),
  accounts: z
    .array(z.object({ id, name: z.string().max(2000).nullable() }))
    .default([]),
})
const historyResponse = z.object({
  meta: z.object({ previous: z.string().nullable().optional() }),
  events: z
    .array(
      z
        .object({
          id: z.string().regex(/^[1-9]\d{0,19}-events$/),
          createdTime: seconds,
          payloadType: z.string(),
          action: z.string(),
          links: z.object({ payloads: z.array(id) }).passthrough(),
        })
        .passthrough(),
    )
    .max(30),
  payloads: z
    .array(
      z
        .object({
          id,
          type: z.string(),
          links: z.record(z.unknown()).optional(),
        })
        .passthrough(),
    )
    .default([]),
  assigneeEntity: z
    .array(
      z
        .object({
          id,
          type: z.string(),
          emails: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .default([]),
})

export type EligibleLead = {
  status: 'eligible'
  companyName: string
  leadUrl: string
  leadCreatedAt: Date
  assigneeId: string
  assigneeEmail: string
  assignmentEventId: string
}
export type HydrationResult =
  | EligibleLead
  | { status: 'pending' | 'excluded'; reason: string }

type HydrationOptions = {
  cutoff: Date
  email: string
  apiKey: string
  fetcher?: typeof fetch
  signal?: AbortSignal
}
type HistoryPage = z.infer<typeof historyResponse>
type HistoryEvent = HistoryPage['events'][number]
type History = {
  events: Map<string, HistoryEvent>
  payloads: Map<string, HistoryPage['payloads'][number]>
  users: Map<string, HistoryPage['assigneeEntity'][number]>
}
type HistoryBoundary = { id: bigint; time: number }
type RestReader = (path: string) => Promise<unknown>

// Expected evidence failures carry only a non-PII reason to the public boundary.
class PendingEvidence extends Error {}

function createRestReader(options: HydrationOptions): RestReader {
  return async (path) => {
    const response = await (options.fetcher ?? fetch)(
      `https://app.nutshell.com/rest/${path}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${options.email}:${options.apiKey}`).toString('base64')}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: options.signal ?? AbortSignal.timeout(8000),
      },
    )
    if (!response.ok) throw new Error('rest_unavailable')
    return response.json()
  }
}

function leadBrowserUrl(htmlUrl: string) {
  const url = new URL(htmlUrl)
  if (
    url.origin !== 'https://app.nutshell.com' ||
    url.username ||
    url.password ||
    !/^\/leads?\/[1-9]\d*\/?$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new PendingEvidence('unsafe_lead_url')
  return url.href
}

function resolveLeadDisplay(raw: unknown, leadId: string, cutoff: Date) {
  const data = leadResponse.parse(raw)
  const matches = data.leads.filter((lead) => lead.id === leadId)
  if (matches.length !== 1) throw new PendingEvidence('lead_join_missing')
  const lead = matches[0]
  const leadCreatedAt = new Date(lead.createdTime.timestamp * 1000)
  if (!lead.links.sources.includes('35-sources') || leadCreatedAt < cutoff)
    return { status: 'excluded' as const, reason: 'source_or_cutoff' }
  const leadUrl = leadBrowserUrl(lead.htmlUrl)
  const firstAccount = lead.links.accounts[0]
  const accounts = data.accounts.filter(
    (account) => account.id === firstAccount,
  )
  if (firstAccount && accounts.length !== 1)
    throw new PendingEvidence('company_join_missing')
  const companyName = accounts[0]?.name?.trim() || lead.name.trim()
  if (!companyName) throw new PendingEvidence('display_name_missing')
  return {
    status: 'eligible' as const,
    companyName,
    leadUrl,
    leadCreatedAt,
  }
}

const cursorParameters = z
  .object({
    entity_id: z.string(),
    events: z.literal('assignments'),
    limit: z.string().regex(/^(?:[1-9]|[12]\d|30)$/),
    max_id: z
      .string()
      .regex(/^[1-9]\d{0,19}(?:-events)?$/)
      .optional(),
    max_time: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
  })
  .strict()

function parseHistoryCursor(previous: string) {
  const cursor = new URL(previous, 'https://app.nutshell.com/rest/events')
  const params = cursor.searchParams
  if (
    cursor.origin !== 'https://app.nutshell.com' ||
    cursor.pathname !== '/rest/events' ||
    cursor.username ||
    cursor.password ||
    cursor.hash
  )
    throw new PendingEvidence('unsafe_history_cursor')
  const keys = [...params.keys()]
  if (keys.some((key) => params.getAll(key).length !== 1))
    throw new PendingEvidence('unsafe_history_cursor')
  const parsed = cursorParameters.safeParse(Object.fromEntries(params))
  if (!parsed.success) throw new PendingEvidence('unsafe_history_cursor')
  return { params, values: parsed.data }
}

function olderHistoryPath(
  previous: string,
  leadId: string,
  oldest: HistoryBoundary,
) {
  const { params, values } = parseHistoryCursor(previous)
  if (values.entity_id !== leadId || (!values.max_id && !values.max_time))
    throw new PendingEvidence('unsafe_history_cursor')
  if (values.max_id && BigInt(values.max_id.split('-')[0]) > oldest.id)
    throw new PendingEvidence('unsafe_history_cursor')
  if (values.max_time && Number(values.max_time) > oldest.time)
    throw new PendingEvidence('unsafe_history_cursor')
  params.sort()
  return `events?${params}`
}

function mergeEntities<T extends { id: string }>(
  target: Map<string, T>,
  entries: T[],
) {
  for (const entry of entries) {
    const previous = target.get(entry.id)
    if (previous && !isDeepStrictEqual(previous, entry))
      throw new PendingEvidence('history_id_conflict')
    target.set(entry.id, entry)
  }
}

function mergeHistoryPage(
  history: History,
  page: HistoryPage,
  oldest: HistoryBoundary | null,
): HistoryBoundary {
  const previousCount = history.events.size
  mergeEntities(history.events, page.events)
  mergeEntities(history.payloads, page.payloads)
  mergeEntities(history.users, page.assigneeEntity)
  if (!page.events.length || history.events.size === previousCount)
    throw new PendingEvidence('history_no_progress')
  const boundary = {
    id: page.events.reduce(
      (min, event) => {
        const value = BigInt(event.id.split('-')[0])
        return value < min ? value : min
      },
      BigInt(page.events[0].id.split('-')[0]),
    ),
    time: Math.min(...page.events.map((event) => event.createdTime)),
  }
  if (oldest && boundary.id >= oldest.id && boundary.time >= oldest.time)
    throw new PendingEvidence('history_no_progress')
  return boundary
}

function creationAnchors(history: History, leadId: string) {
  return [...history.events.values()].filter(
    (event) =>
      event.payloadType === 'leads' &&
      event.action === 'create' &&
      event.links.payloads.includes(leadId),
  )
}

async function retrieveHistory(
  read: RestReader,
  leadId: string,
): Promise<History> {
  const history: History = {
    events: new Map(),
    payloads: new Map(),
    users: new Map(),
  }
  let path = `events?entity_id=${leadId}&events=assignments&limit=30`
  const cursors = new Set<string>()
  let oldest: HistoryBoundary | null = null
  // Only walk older pages, stopping at creation. The observed API's `next`
  // points toward newer events and is not a completeness signal.
  for (let page = 0; page < 5; page++) {
    if (cursors.has(path)) throw new PendingEvidence('history_cursor_loop')
    cursors.add(path)
    const parsed = historyResponse.safeParse(await read(path))
    if (!parsed.success) throw new PendingEvidence('history_incomplete')
    oldest = mergeHistoryPage(history, parsed.data, oldest)
    if (creationAnchors(history, leadId).length) break
    if (!parsed.data.meta.previous)
      throw new PendingEvidence('creation_anchor_missing')
    path = olderHistoryPath(parsed.data.meta.previous, leadId, oldest)
  }
  return history
}

const assignmentPayload = z.object({
  id: z.string().regex(/^[1-9]\d{0,19}-assignments$/),
  type: z.literal('assignments'),
  links: z.object({
    assignmentEntity: z.unknown(),
    assigneeEntity: id,
    replacedEntityAssignment: z
      .string()
      .regex(/^[1-9]\d{0,19}-assignments$/)
      .nullable(),
  }),
})
type JoinedAssignment = {
  event: HistoryEvent
  payload: z.infer<typeof assignmentPayload>
}

function joinAssignments(
  history: History,
  leadId: string,
  createdTime: number,
): JoinedAssignment[] {
  const assignments = [...history.events.values()].filter(
    (event) => event.payloadType === 'assignments',
  )
  return assignments.map((event) => {
    if (
      event.action !== 'create' ||
      event.createdTime < createdTime ||
      event.links.payloads.length !== 1
    )
      throw new PendingEvidence('assignment_unsupported')
    const parsed = assignmentPayload.safeParse(
      history.payloads.get(event.links.payloads[0]),
    )
    if (!parsed.success || parsed.data.links.assignmentEntity !== leadId)
      throw new PendingEvidence('assignment_join_missing')
    return { event, payload: parsed.data }
  })
}

function validateReplacementChains(
  assignments: JoinedAssignment[],
  root: JoinedAssignment,
) {
  for (const assignment of assignments) {
    let current = assignment
    const visited = new Set<string>()
    while (current.payload.id !== root.payload.id) {
      if (visited.has(current.payload.id))
        throw new PendingEvidence('assignment_chain_invalid')
      visited.add(current.payload.id)
      const predecessors = assignments.filter(
        ({ payload }) =>
          payload.id === current.payload.links.replacedEntityAssignment,
      )
      if (
        predecessors.length !== 1 ||
        // Explicit predecessor links order assignments within the same second.
        predecessors[0].event.createdTime > current.event.createdTime
      )
        throw new PendingEvidence('assignment_chain_invalid')
      current = predecessors[0]
    }
  }
}

function resolveInitialAssignment(
  history: History,
  leadId: string,
  createdTime: number,
) {
  const anchors = creationAnchors(history, leadId)
  if (anchors.length !== 1 || anchors[0].createdTime !== createdTime)
    throw new PendingEvidence('creation_anchor_missing')
  const assignments = joinAssignments(history, leadId, createdTime)
  // Observed contract: creation anchor + one original (null replacement)
  // identifies initial assignment. Retention/visibility remain vendor gates.
  const roots = assignments.filter(
    ({ payload }) => payload.links.replacedEntityAssignment === null,
  )
  if (roots.length !== 1)
    throw new PendingEvidence('assignment_ambiguous_or_missing')
  const root = roots[0]
  const assigneeId = root.payload.links.assigneeEntity
  if (!/^[1-9]\d{0,19}-users$/.test(assigneeId))
    throw new PendingEvidence('assignment_unsupported')
  validateReplacementChains(assignments, root)
  const users = [...history.users.values()].filter(
    (user) => user.id === assigneeId && user.type === 'users',
  )
  if (users.length !== 1 || users[0].emails?.length !== 1)
    throw new PendingEvidence('assignee_email_ambiguous')
  const email = z
    .string()
    .email()
    .safeParse(users[0].emails[0].trim().toLowerCase())
  if (!email.success) throw new PendingEvidence('assignee_email_missing')
  return {
    assigneeId,
    assigneeEmail: email.data,
    assignmentEventId: root.event.id,
  }
}

/** Authoritative REST boundary. No callback URLs, actors, or current owners. */
export async function hydrateLead(
  leadId: string,
  options: HydrationOptions,
): Promise<HydrationResult> {
  if (!/^[1-9]\d{0,19}-leads$/.test(leadId))
    return { status: 'pending', reason: 'invalid_lead_id' }
  const read = createRestReader(options)
  try {
    const display = resolveLeadDisplay(
      await read(`leads/${leadId}`),
      leadId,
      options.cutoff,
    )
    if (display.status === 'excluded') return display
    const history = await retrieveHistory(read, leadId)
    const assignment = resolveInitialAssignment(
      history,
      leadId,
      display.leadCreatedAt.getTime() / 1000,
    )
    return { ...display, ...assignment }
  } catch (error) {
    return {
      status: 'pending',
      reason:
        error instanceof PendingEvidence
          ? error.message
          : 'rest_unavailable_or_invalid',
    }
  }
}
