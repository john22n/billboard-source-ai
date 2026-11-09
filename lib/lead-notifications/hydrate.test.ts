import { expect, it, vi } from 'vitest'
import { hydrateLead } from './hydrate'

const lead = {
  leads: [
    {
      id: '101-leads',
      name: 'Fallback',
      createdTime: { timestamp: 1800000000 },
      htmlUrl: 'https://app.nutshell.com/lead/101',
      links: {
        sources: ['35-sources'],
        accounts: ['22-accounts', '21-accounts'],
      },
    },
  ],
  accounts: [
    { id: '21-accounts', name: 'Second' },
    { id: '22-accounts', name: 'First' },
  ],
}
const history = {
  meta: {
    next: 'https://app.nutshell.com/rest/events?entity_id=101-leads&events=assignments&limit=30&since_id=502-events&since_time=1800000001',
    previous:
      'https://app.nutshell.com/rest/events?entity_id=101-leads&events=assignments&limit=30&max_id=501-events&max_time=1800000000',
  },
  events: [
    {
      id: '501-events',
      createdTime: 1800000000,
      payloadType: 'leads',
      action: 'create',
      links: { payloads: ['101-leads'] },
    },
    {
      id: '502-events',
      createdTime: 1800000001,
      payloadType: 'assignments',
      action: 'create',
      links: { payloads: ['201-assignments'] },
    },
  ],
  payloads: [
    {
      id: '201-assignments',
      type: 'assignments',
      links: {
        assigneeEntity: '301-users',
        assignmentEntity: '101-leads',
        replacedEntityAssignment: null,
      },
    },
  ],
  assigneeEntity: [
    { id: '301-users', type: 'users', emails: ['REP@example.test'] },
  ],
}

it('hydrates joined initial assignment and first linked company, never owner or actor', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(Response.json(history))
  const result = await hydrateLead('101-leads', {
    cutoff: new Date('2026-01-01Z'),
    email: 'sky@example.test',
    apiKey: 'key',
    fetcher,
  })
  expect(result).toMatchObject({
    status: 'eligible',
    companyName: 'First',
    assigneeId: '301-users',
    assigneeEmail: 'rep@example.test',
    leadCreatedAt: new Date(1800000000000),
  })
  expect(String(fetcher.mock.calls[1][0])).toContain('events=assignments')
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    cache: 'no-store',
  })
})

it.each([
  [
    'missing creation anchor and older cursor',
    { ...history, meta: {}, events: history.events.slice(1) },
  ],
  [
    'team assignment',
    {
      ...history,
      payloads: [
        {
          ...history.payloads[0],
          links: { ...history.payloads[0].links, assigneeEntity: '1-teams' },
        },
      ],
    },
  ],
])('retains %s for retry', async (_label, response) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(Response.json(response))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending' })
})

it.each([
  [
    'other source',
    { ...lead.leads[0], links: { sources: ['115-sources'], accounts: [] } },
    'excluded',
  ],
  [
    'before cutoff',
    { ...lead.leads[0], createdTime: { timestamp: 1700000000 } },
    'excluded',
  ],
  [
    'foreign browser URL',
    { ...lead.leads[0], htmlUrl: 'https://evil.test/leads/101' },
    'pending',
  ],
  ['mismatched entity', { ...lead.leads[0], id: '102-leads' }, 'pending'],
])('does not notify for %s', async (_label, entity, status) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...lead, leads: [entity] }))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01T00:00:00Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status })
  expect(fetcher).toHaveBeenCalledOnce()
})

it('includes the exact launch boundary and uses lead-name fallback without a company', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        leads: [
          {
            ...lead.leads[0],
            links: { sources: ['35-sources'], accounts: [] },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json(history))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date(1800000000000),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'eligible', companyName: 'Fallback' })
})

it('keeps delayed assignment pending even when a current owner is present', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        ...lead,
        owners: [{ id: '999-users', emails: ['wrong@example.test'] }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ ...history, events: history.events.slice(0, 1) }),
    )
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01T00:00:00Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({
    status: 'pending',
    reason: 'assignment_ambiguous_or_missing',
  })
})

const olderCursor =
  'https://app.nutshell.com/rest/events?entity_id=101-leads&events=assignments&limit=30&max_id=502-events&max_time=1800000001'

it('walks only older pages to creation and deduplicates inclusive event/payload/user IDs', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(
      Response.json({
        ...history,
        events: history.events.slice(1),
        meta: { next: history.meta.next, previous: olderCursor },
      }),
    )
    .mockResolvedValueOnce(Response.json(history))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'eligible', assigneeId: '301-users' })
  expect(fetcher).toHaveBeenCalledTimes(3)
  const requested = new URL(String(fetcher.mock.calls[2][0]))
  expect(requested.searchParams.get('max_id')).toBe('502-events')
  expect(requested.searchParams.has('since_id')).toBe(false)
})

const replacement = {
  ...history,
  events: [
    ...history.events,
    {
      ...history.events[1],
      id: '503-events',
      createdTime: 1800000002,
      links: { payloads: ['202-assignments'] },
    },
  ],
  payloads: [
    ...history.payloads,
    {
      id: '202-assignments',
      type: 'assignments',
      links: {
        assigneeEntity: '302-users',
        assignmentEntity: '101-leads',
        replacedEntityAssignment: '201-assignments',
      },
    },
  ],
  assigneeEntity: [
    ...history.assigneeEntity,
    { id: '302-users', type: 'users', emails: ['later@example.test'] },
  ],
}

it.each([1800000001, 1800000002])(
  'keeps the original user when its replacement has timestamp %i',
  async (createdTime) => {
    const page = structuredClone(replacement)
    page.events[2].createdTime = createdTime
    page.events.reverse()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(lead))
      .mockResolvedValueOnce(Response.json(page))
    expect(
      await hydrateLead('101-leads', {
        cutoff: new Date('2026-01-01Z'),
        email: 'sky@example.test',
        apiKey: 'key',
        fetcher,
      }),
    ).toMatchObject({
      status: 'eligible',
      assigneeId: '301-users',
      assignmentEventId: '502-events',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)

it.each([
  olderCursor.replace('app.nutshell.com', 'evil.test'),
  olderCursor.replace('app.nutshell.com', 'user:password@app.nutshell.com'),
  `${olderCursor}#fragment`,
  olderCursor.replace('/rest/events', '/rest/leads'),
  olderCursor.replace('101-leads', '999-leads'),
  olderCursor.replace('events=assignments', 'events=comments'),
  olderCursor.replace('limit=30', 'limit=31'),
  `${olderCursor}&entity_id=101-leads`,
  olderCursor.replace('max_id=', 'since_id='),
])('rejects unsafe older cursor %s without fetching it', async (previous) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(
      Response.json({
        ...history,
        events: history.events.slice(1),
        meta: { previous },
      }),
    )
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending', reason: 'unsafe_history_cursor' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it.each(['events', 'payloads', 'assigneeEntity'] as const)(
  'rejects conflicting repeated %s IDs across inclusive pages',
  async (collection) => {
    const second = structuredClone(history)
    if (collection === 'events') second.events[1].createdTime++
    if (collection === 'payloads')
      second.payloads[0].links.assigneeEntity = '302-users'
    if (collection === 'assigneeEntity')
      second.assigneeEntity[0].emails = ['changed@example.test']
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(lead))
      .mockResolvedValueOnce(
        Response.json({
          ...history,
          events: history.events.slice(1),
          meta: { previous: olderCursor },
        }),
      )
      .mockResolvedValueOnce(Response.json(second))
    expect(
      await hydrateLead('101-leads', {
        cutoff: new Date('2026-01-01Z'),
        email: 'sky@example.test',
        apiKey: 'key',
        fetcher,
      }),
    ).toMatchObject({ status: 'pending', reason: 'history_id_conflict' })
  },
)

it('retains repeated pages with no older progress rather than spinning', async () => {
  const page = {
    ...history,
    events: history.events.slice(1),
    meta: { previous: olderCursor },
  }
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockImplementation(async () => Response.json(page))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending', reason: 'history_no_progress' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('does not discard conflicting event relationship fields during duplicate validation', async () => {
  const assignment = {
    ...history.events[1],
    links: { ...history.events[1].links, actor: '901-users' },
  }
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(
      Response.json({
        ...history,
        events: [assignment],
        meta: { previous: olderCursor },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        ...history,
        events: [
          history.events[0],
          { ...assignment, links: { ...assignment.links, actor: '902-users' } },
        ],
      }),
    )
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending', reason: 'history_id_conflict' })
})

it('caps older traversal at five pages even when every page makes progress', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
  for (let index = 0; index < 6; index++) {
    const eventId = 1000 - index
    const createdTime = 1800000100 - index
    fetcher.mockResolvedValueOnce(
      Response.json({
        meta: {
          previous: `https://app.nutshell.com/rest/events?entity_id=101-leads&events=assignments&limit=30&max_id=${eventId}-events&max_time=${createdTime}`,
        },
        events: [
          {
            id: `${eventId}-events`,
            createdTime,
            payloadType: 'comments',
            action: 'create',
            links: { payloads: [] },
          },
        ],
      }),
    )
  }
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending', reason: 'creation_anchor_missing' })
  expect(fetcher).toHaveBeenCalledTimes(6) // one lead + five event pages
})

it.each([
  [
    'replacement timestamp before its predecessor',
    {
      ...replacement,
      events: replacement.events.map((event) =>
        event.id === '503-events'
          ? { ...event, createdTime: 1800000000 }
          : event,
      ),
    },
  ],
  [
    'same-second replacement cycle',
    {
      ...replacement,
      events: replacement.events.map((event) =>
        event.id === '503-events'
          ? { ...event, createdTime: 1800000001 }
          : event,
      ),
      payloads: replacement.payloads.map((payload) =>
        payload.id === '202-assignments'
          ? {
              ...payload,
              links: {
                ...payload.links,
                replacedEntityAssignment: '202-assignments',
              },
            }
          : payload,
      ),
    },
  ],
  [
    'multiple roots',
    {
      ...replacement,
      payloads: replacement.payloads.map((payload) => ({
        ...payload,
        links: { ...payload.links, replacedEntityAssignment: null },
      })),
    },
  ],
  [
    'missing replacement predecessor',
    {
      ...replacement,
      payloads: [
        replacement.payloads[0],
        {
          ...replacement.payloads[1],
          links: {
            ...replacement.payloads[1].links,
            replacedEntityAssignment: '999-assignments',
          },
        },
      ],
    },
  ],
  [
    'team original with later user',
    {
      ...replacement,
      payloads: [
        {
          ...replacement.payloads[0],
          links: {
            ...replacement.payloads[0].links,
            assigneeEntity: '1-teams',
          },
        },
        replacement.payloads[1],
      ],
    },
  ],
  [
    'incorrect creation time',
    {
      ...history,
      events: [
        { ...history.events[0], createdTime: 1799999999 },
        history.events[1],
      ],
    },
  ],
])('keeps %s pending', async (_label, page) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(Response.json(page))
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending' })
})

it('treats a terminal empty older page without a creation anchor as incomplete', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(lead))
    .mockResolvedValueOnce(
      Response.json({
        ...history,
        events: history.events.slice(1),
        meta: { previous: olderCursor },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ events: [], meta: { instanceId: '1', siteId: '2' } }),
    )
  expect(
    await hydrateLead('101-leads', {
      cutoff: new Date('2026-01-01Z'),
      email: 'sky@example.test',
      apiKey: 'key',
      fetcher,
    }),
  ).toMatchObject({ status: 'pending' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
