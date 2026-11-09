import { expect, test } from 'playwright/test'
import { Pool } from 'pg'
import { databaseUrl } from './environment'

const endpoint =
  '/api/webhooks/nutshell?token=playwright-nutshell-webhook-local-only'

test.describe.configure({ mode: 'serial' })

test('webhook rejects a request without its bearer token', async ({
  request,
}) => {
  const response = await request.post('/api/webhooks/nutshell', {
    data: { events: [] },
  })
  expect(response.status()).toBe(401)
  expect(await response.json()).toEqual({ error: 'Unauthorized' })
})

test('webhook rejects wrong or ambiguous credentials and malformed or oversized input', async ({
  request,
}) => {
  for (const url of [
    '/api/webhooks/nutshell?token=wrong',
    `${endpoint}&token=another`,
  ]) {
    const response = await request.post(url, { data: { events: [] } })
    expect(response.status()).toBe(401)
  }
  for (const body of ['not-json', '{}', '{"events":null}']) {
    const response = await request.post(endpoint, { data: body })
    expect(response.status()).toBe(400)
  }
  const oversized = await request.post(endpoint, {
    data: { events: [], padding: 'x'.repeat(1024 * 1024) },
  })
  expect(oversized.status()).toBe(413)
  const ignored = await request.post(endpoint, {
    data: { events: [{ payloadType: 'contacts', action: 'update' }] },
  })
  expect(ignored.status()).toBe(200)
  expect(await ignored.json()).toEqual({ accepted: 0 })
})

test('webhook durably accepts all linked new leads once without trusting embedded payloads', async ({
  request,
}) => {
  const body = {
    events: [
      {
        id: '11-events',
        payloadType: 'contacts',
        action: 'create',
        links: { payloads: ['9-contacts'] },
      },
      {
        id: '12-events',
        payloadType: 'leads',
        action: 'create',
        createdTime: 1800000000,
        links: { payloads: ['101-leads', '102-leads'] },
      },
      {
        id: '13-events',
        payloadType: 'leads',
        action: 'update',
        links: { payloads: ['103-leads'] },
      },
    ],
    payloads: [
      {
        id: '999-leads',
        name: 'Do not persist customer payloads',
        href: 'https://example.invalid/',
      },
    ],
  }
  const response = await request.post(endpoint, { data: body })
  expect(response.status()).toBe(202)
  expect(await response.json()).toEqual({ accepted: 2 })
  const replay = await request.post(endpoint, { data: body })
  expect(replay.status()).toBe(202)
  expect(await replay.json()).toEqual({ accepted: 0 })

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(
      `SELECT event_id, lead_id, status FROM nutshell_webhook_inbox ORDER BY lead_id`,
    )
    expect(result.rows).toEqual([
      { event_id: '12-events', lead_id: '101-leads', status: 'pending' },
      { event_id: '12-events', lead_id: '102-leads', status: 'pending' },
    ])
  } finally {
    await pool.end()
  }
})

test('webhook rejects an invalid batch without partial acceptance', async ({
  request,
}) => {
  const response = await request.post(endpoint, {
    data: {
      events: [
        {
          id: '31-events',
          payloadType: 'leads',
          action: 'create',
          links: { payloads: ['301-leads'] },
        },
        {
          id: '32-events',
          payloadType: 'leads',
          action: 'create',
          links: { payloads: ['https://example.invalid/302-leads'] },
        },
      ],
    },
  })
  expect(response.status()).toBe(400)
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    expect(
      (
        await pool.query(
          `SELECT id FROM nutshell_webhook_inbox WHERE event_id = '31-events'`,
        )
      ).rowCount,
    ).toBe(0)
  } finally {
    await pool.end()
  }
})

test('concurrent deliveries create one inbox item and replay preserves processed state', async ({
  request,
}) => {
  const body = {
    events: [
      {
        id: '41-events',
        payloadType: 'leads',
        action: 'create',
        links: { payloads: ['401-leads'] },
      },
    ],
  }
  const responses = await Promise.all([
    request.post(endpoint, { data: body }),
    request.post(endpoint, { data: body }),
  ])
  expect(responses.map((r) => r.status())).toEqual([202, 202])
  const results = await Promise.all(responses.map((r) => r.json()))
  expect(results.map((r) => r.accepted).sort()).toEqual([0, 1])
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await pool.query(
      `UPDATE nutshell_webhook_inbox SET status = 'processed' WHERE event_id = '41-events'`,
    )
    const replay = await request.post(endpoint, { data: body })
    expect(await replay.json()).toEqual({ accepted: 0 })
    expect(
      (
        await pool.query(
          `SELECT status FROM nutshell_webhook_inbox WHERE event_id = '41-events'`,
        )
      ).rows,
    ).toEqual([{ status: 'processed' }])
  } finally {
    await pool.end()
  }
})

test('webhook does not acknowledge a database failure', async ({ request }) => {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await pool.query(
      'ALTER TABLE nutshell_webhook_inbox RENAME TO unavailable_webhook_inbox',
    )
    try {
      const response = await request.post(endpoint, {
        data: {
          events: [
            {
              id: '51-events',
              payloadType: 'leads',
              action: 'create',
              links: { payloads: ['501-leads'] },
            },
          ],
        },
      })
      expect(response.status()).toBe(503)
      expect(await response.json()).toEqual({ error: 'Webhook unavailable' })
    } finally {
      await pool.query(
        'ALTER TABLE unavailable_webhook_inbox RENAME TO nutshell_webhook_inbox',
      )
    }
  } finally {
    await pool.end()
  }
})
