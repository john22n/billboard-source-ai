import { SignJWT } from 'jose'
import { expect, test, type BrowserContext } from 'playwright/test'
import { Pool } from 'pg'
import { createServerConfig } from '../../lib/config-core'
import { baseUrl, databaseUrl, jwtSecret, userId } from './environment'

async function signIn(context: BrowserContext, accountId = userId) {
  const token = await new SignJWT({ userId: accountId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret))
  await context.addCookies([{ name: 'auth_token', value: token, url: baseUrl }])
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/taskrouter/worker-status', (route) =>
    route.fulfill({ json: { status: 'offline', success: true } }),
  )
  await context.route('**/api/twilio-token', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Telephony disabled in tests' },
    }),
  )
  await context.route('https://app.nutshell.com/**', (route) =>
    route.fulfill({ body: 'Synthetic Nutshell lead page' }),
  )
})

test('lead inbox shows ages, opens without clearing, and retains failed clears', async ({
  page,
  context,
}, testInfo) => {
  await signIn(context)
  const now = new Date('2026-11-09T12:00:00Z')
  await page.clock.install({ time: now })
  let notifications = [
    {
      id: '1',
      companyName: 'Northstar Outdoor',
      leadUrl: 'https://app.nutshell.com/lead/10',
      leadCreatedAt: '2026-11-09T07:59:59Z',
      createdAt: now.toISOString(),
    },
    {
      id: '2',
      companyName: 'Yellow Company',
      leadUrl: 'https://app.nutshell.com/lead/11',
      leadCreatedAt: '2026-11-09T11:00:00Z',
      createdAt: now.toISOString(),
    },
    {
      id: '3',
      companyName: 'Fresh Lead',
      leadUrl: 'https://app.nutshell.com/lead/12',
      leadCreatedAt: '2026-11-09T11:30:00Z',
      createdAt: now.toISOString(),
    },
  ]
  await page.route('**/api/lead-notifications', (route) =>
    route.fulfill({
      json: { notifications, serverTime: now.toISOString(), userId },
    }),
  )
  let failClear = true
  await page.route('**/api/lead-notifications/1/clear', (route) => {
    if (failClear)
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
    notifications = notifications.filter((n) => n.id !== '1')
    return route.fulfill({ json: { success: true } })
  })
  await page.goto('/issues')
  const panel = page.getByRole('region', { name: 'Contact Us leads' })
  await expect(panel.getByRole('listitem')).toHaveCount(3)
  await expect(
    page.getByRole('button', { name: /Lead notifications,/ }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: 'Contact Us leads' }),
  ).toHaveCount(0)
  const first = await panel.getByRole('listitem').nth(0).boundingBox()
  const second = await panel.getByRole('listitem').nth(1).boundingBox()
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height)
  await expect(panel.getByText('Over 4 hours', { exact: true })).toBeVisible()
  await expect(panel.getByText('1–4 hours', { exact: true })).toBeVisible()
  await expect(panel.getByText('Under 1 hour', { exact: true })).toBeVisible()
  const lead = panel.getByRole('link', { name: /Northstar Outdoor/ })
  await expect(lead).toHaveAttribute('target', '_blank')
  const popup = page.waitForEvent('popup')
  await lead.click()
  await (await popup).close()
  await expect(lead).toBeVisible()
  await panel.getByRole('button', { name: 'Clear Northstar Outdoor' }).click()
  await expect(panel.getByRole('alert')).toContainText('Could not clear')
  await expect(lead).toBeVisible()
  failClear = false
  await panel.getByRole('button', { name: 'Clear Northstar Outdoor' }).click()
  await expect(lead).toHaveCount(0)
  await page.reload()
  await expect(panel.getByRole('listitem')).toHaveCount(2)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/dashboard')
  await expect(panel.getByRole('listitem')).toHaveCount(2)
  const main = page.getByRole('main')
  await expect(main).toBeVisible()
  const bounds = await main.boundingBox()
  expect(bounds!.y).toBe(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900)
  await page.screenshot({
    path: testInfo.outputPath('dashboard-inbox.png'),
    animations: 'disabled',
  })
  notifications = notifications.slice(0, 1)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await page.screenshot({
    path: testInfo.outputPath('single.png'),
    animations: 'disabled',
  })
})

test('desktop alerts require opt-in, deduplicate tabs, and do not replay on reload or reconnect', async ({
  page,
  context,
}, testInfo) => {
  await signIn(context)
  const alerts: string[] = []
  let permissionRequests = 0
  await context.exposeBinding('recordLeadAlert', (_source, title: string) => {
    alerts.push(title)
  })
  await context.exposeBinding('recordPermissionRequest', () => {
    permissionRequests++
  })
  await context.addInitScript(() => {
    const callbacks = window as unknown as {
      recordLeadAlert: (title: string) => void
      recordPermissionRequest: () => void
    }
    class TestNotification {
      static permission = 'default'
      static async requestPermission() {
        callbacks.recordPermissionRequest()
        this.permission = 'granted'
        return 'granted'
      }
      constructor(title: string) {
        callbacks.recordLeadAlert(title)
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', {
      value: TestNotification,
      configurable: true,
    })
  })
  let time = Date.now()
  const item = (id: string) => ({
    id,
    companyName: `Company ${id}`,
    leadUrl: `https://app.nutshell.com/lead/${id}`,
    leadCreatedAt: new Date(time).toISOString(),
    createdAt: new Date(time).toISOString(),
  })
  const notifications = [item('1')]
  let disconnected = false
  await context.route('**/api/lead-notifications', (route) =>
    disconnected
      ? route.abort()
      : route.fulfill({
          json: {
            notifications,
            serverTime: new Date(time).toISOString(),
            userId,
          },
        }),
  )
  await page.goto('/issues')
  const cards = (p: typeof page) =>
    p.getByRole('region', { name: 'Contact Us leads' }).getByRole('listitem')
  const prompt = page.getByRole('dialog', {
    name: 'Enable lead notifications?',
  })
  await expect(prompt).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('permission-prompt.png'),
    animations: 'disabled',
  })
  expect(permissionRequests).toBe(0)
  expect(alerts).toEqual([])
  await prompt.getByRole('button', { name: 'Enable notifications' }).click()
  await expect(prompt).toHaveCount(0)
  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByText('Desktop alerts', { exact: true })).toHaveCount(0)
  await expect.poll(() => permissionRequests).toBe(1)
  const second = await context.newPage()
  await second.goto('/issues')
  await expect(cards(second)).toHaveCount(1)
  await second.evaluate(() => {
    Object.defineProperty(Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
  })
  time += 1000
  // A transaction may commit after a snapshot with an earlier createdAt.
  notifications.push({
    ...item('2'),
    createdAt: new Date(time - 1000).toISOString(),
  })
  await Promise.all(
    [page, second].map((p) =>
      p.evaluate(() => window.dispatchEvent(new Event('focus'))),
    ),
  )
  await expect.poll(() => alerts).toEqual(['Company 2'])
  for (const p of [page, second]) await expect(cards(p)).toHaveCount(2)
  await page.reload()
  await expect(cards(page)).toHaveCount(2)
  await expect(prompt).toHaveCount(0)
  expect(permissionRequests).toBe(1)
  expect(alerts).toEqual(['Company 2'])
  await second.close()
  disconnected = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(
    page.getByRole('region', { name: 'Contact Us leads' }).getByRole('status'),
  ).toContainText('Updates unavailable')
  time += 1000
  notifications.push(item('3'))
  disconnected = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(cards(page)).toHaveCount(3)
  expect(alerts).toEqual(['Company 2'])
})

for (const choice of ['Not now', 'denied', 'default'] as const) {
  test(`notification onboarding does not repeat after ${choice}`, async ({
    page,
    context,
  }) => {
    await signIn(context)
    let requests = 0
    await context.exposeBinding('permissionRequested', () => {
      requests++
    })
    await context.addInitScript(
      (result) => {
        class TestNotification {
          static permission = 'default'
          static async requestPermission() {
            await (
              window as unknown as { permissionRequested: () => Promise<void> }
            ).permissionRequested()
            this.permission = result
            return result
          }
        }
        Object.defineProperty(window, 'Notification', {
          value: TestNotification,
        })
      },
      choice === 'denied' ? 'denied' : 'default',
    )
    await context.route('**/api/lead-notifications', (route) =>
      route.fulfill({
        json: {
          userId,
          notifications: [
            {
              id: '10',
              companyName: 'In-app lead remains available',
              leadUrl: 'https://app.nutshell.com/lead/10',
              leadCreatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
          serverTime: new Date().toISOString(),
        },
      }),
    )
    await page.goto('/issues')
    const prompt = page.getByRole('dialog', {
      name: 'Enable lead notifications?',
    })
    await expect(prompt).toBeVisible()
    const second = await context.newPage()
    await second.goto('/issues')
    await expect(
      second.getByRole('dialog', { name: 'Enable lead notifications?' }),
    ).toBeVisible()
    await prompt
      .getByRole('button', {
        name: choice === 'Not now' ? 'Not now' : 'Enable notifications',
      })
      .click()
    await expect(prompt).toHaveCount(0)
    await expect(second.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole('link', { name: /In-app lead remains available/ }),
    ).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(prompt).toHaveCount(0)
    expect(requests).toBe(choice === 'Not now' ? 0 : 1)
    await second.close()
  })
}

for (const identityLoss of ['sign-out', 'account-switch'] as const) {
  test(`queued desktop alerts are discarded after ${identityLoss}, even if the original account returns`, async ({
    page,
    context,
  }) => {
    await signIn(context)
    await context.addInitScript(() => {
      class TestNotification {
        static permission = 'granted'
        constructor(title: string) {
          const titles = JSON.parse(localStorage.getItem('test-alerts') || '[]')
          localStorage.setItem(
            'test-alerts',
            JSON.stringify([...titles, title]),
          )
        }
        close() {}
      }
      Object.defineProperty(window, 'Notification', { value: TestNotification })
    })
    const item = (id: string) => ({
      id,
      companyName: `Company ${id}`,
      leadUrl: `https://app.nutshell.com/lead/${id}`,
      leadCreatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    const notifications = [item('1')]
    let lostIdentity = false
    await page.route('**/api/lead-notifications', (route) =>
      lostIdentity && identityLoss === 'sign-out'
        ? route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
        : route.fulfill({
            json: {
              notifications,
              userId: lostIdentity ? 'another-account' : userId,
              serverTime: new Date().toISOString(),
            },
          }),
    )
    await page.goto('/issues')
    const panel = page.getByRole('region', { name: 'Contact Us leads' })
    await expect(panel.getByRole('listitem')).toHaveCount(1)
    const lockName = `lead-alerts:${userId}`
    await page.evaluate((name) => {
      void navigator.locks.request(
        name,
        () =>
          new Promise<void>((resolve) => {
            window.addEventListener('release-alert-lock', () => resolve(), {
              once: true,
            })
          }),
      )
    }, lockName)
    await expect
      .poll(() =>
        page.evaluate(
          async (name) =>
            (await navigator.locks.query()).held?.some(
              (lock) => lock.name === name,
            ),
          lockName,
        ),
      )
      .toBe(true)
    notifications.push(item('2'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(panel.getByRole('listitem')).toHaveCount(2)
    await expect
      .poll(() =>
        page.evaluate(
          async (name) =>
            (await navigator.locks.query()).pending?.some(
              (lock) => lock.name === name,
            ),
          lockName,
        ),
      )
      .toBe(true)
    lostIdentity = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(panel).toHaveCount(0)
    lostIdentity = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(panel.getByRole('listitem')).toHaveCount(2)
    await page.evaluate(async (name) => {
      window.dispatchEvent(new Event('release-alert-lock'))
      await navigator.locks.request(name, () => {})
    }, lockName)
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('test-alerts') || '[]'),
      ),
    ).toEqual([])
    notifications.push(item('3'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem('test-alerts') || '[]'),
        ),
      )
      .toEqual(['Company 3'])
  })
}

test('urgency boundaries tick without refresh and the inbox handles denied permission and disconnection', async ({
  page,
  context,
}, testInfo) => {
  await signIn(context)
  await page.setViewportSize({ width: 1280, height: 900 })
  const now = new Date('2026-11-09T12:00:00Z')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await context.addInitScript(() => {
    Object.defineProperty(window, 'Notification', {
      value: class {
        static permission = 'denied'
      },
      configurable: true,
    })
  })
  let notifications = [
    {
      id: '4',
      companyName: 'Weekend assignment',
      leadUrl: 'https://app.nutshell.com/lead/4',
      leadCreatedAt: '2026-11-06T12:00:00Z',
      createdAt: now.toISOString(),
    },
    {
      id: '3',
      companyName: 'Exactly four hours',
      leadUrl: 'https://app.nutshell.com/lead/3',
      leadCreatedAt: '2026-11-09T08:00:00Z',
      createdAt: now.toISOString(),
    },
    {
      id: '2',
      companyName: 'Exactly one hour',
      leadUrl: 'https://app.nutshell.com/lead/2',
      leadCreatedAt: '2026-11-09T11:00:00Z',
      createdAt: now.toISOString(),
    },
    {
      id: '1',
      companyName: 'Just under one hour',
      leadUrl: 'https://app.nutshell.com/lead/1',
      leadCreatedAt: '2026-11-09T11:00:00.001Z',
      createdAt: now.toISOString(),
    },
  ]
  let disconnected = false
  await page.route('**/api/lead-notifications', (route) =>
    disconnected
      ? route.abort()
      : route.fulfill({
          json: { notifications, userId, serverTime: now.toISOString() },
        }),
  )
  await page.goto('/issues')
  const panel = page.getByRole('region', { name: 'Contact Us leads' })
  await expect(panel.getByRole('listitem')).toHaveCount(4)
  const row = (name: string) =>
    panel
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: new RegExp(name) }) })
  await expect(
    row('Exactly four hours').getByText('1–4 hours', { exact: true }),
  ).toBeVisible()
  await expect(
    row('Exactly one hour').getByText('1–4 hours', { exact: true }),
  ).toBeVisible()
  await expect(
    row('Just under one hour').getByText('Under 1 hour', { exact: true }),
  ).toBeVisible()
  await expect(row('Weekend assignment')).toContainText('72h 0m elapsed')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(panel.getByText('Desktop alerts', { exact: true })).toHaveCount(
    0,
  )
  await page.screenshot({
    path: testInfo.outputPath('active-denied.png'),
    animations: 'disabled',
  })
  await page.clock.runFor(1000)
  await expect(
    row('Exactly four hours').getByText('Over 4 hours', { exact: true }),
  ).toBeVisible()
  await expect(
    row('Just under one hour').getByText('1–4 hours', { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 375, height: 900 })
  await expect(panel).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('mobile-active.png'),
    animations: 'disabled',
  })
  disconnected = true
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(panel.getByRole('status')).toContainText('Updates unavailable')
  await page.screenshot({
    path: testInfo.outputPath('disconnected.png'),
    animations: 'disabled',
  })
  notifications = []
  disconnected = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(panel.getByRole('listitem')).toHaveCount(0)
  await expect(panel.getByRole('status')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: testInfo.outputPath('empty.png'),
    animations: 'disabled',
  })
})

test('real processor delivers only to the initial recipient and Clear survives replay and sign-out', async ({
  page,
  context,
  browser,
}) => {
  process.env.DATABASE_URL = databaseUrl
  const { processLeadNotifications } =
    await import('../../lib/lead-notifications/processor')
  const pool = new Pool({ connectionString: databaseUrl })
  const other = await browser.newContext({ baseURL: baseUrl })
  const config = createServerConfig({
    NUTSHELL_NOTIFICATIONS_ENABLED: 'true',
    LEAD_NOTIFICATIONS_LAUNCH_CUTOFF: '2026-01-01T00:00:00Z',
    LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST:
      'alpha@example.test,beta@example.test',
    NUTSHELL_API_KEY: 'synthetic-local-test-key',
  })
  let assignmentReady = false
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    const leadId = url.pathname.startsWith('/rest/leads/')
      ? url.pathname.split('/').at(-1)!
      : url.searchParams.get('entity_id')!
    const number = leadId.split('-')[0]
    const secondRep = leadId === '77002-leads'
    const assignee = secondRep
      ? { id: '302-users', emails: ['BETA@example.test'] }
      : { id: '301-users', emails: ['ALPHA@example.test'] }
    const replacementAssignee = secondRep
      ? { id: '301-users', emails: ['ALPHA@example.test'] }
      : { id: '302-users', emails: ['BETA@example.test'] }
    const created = leadId === '77004-leads' ? 1700000000 : 1794225600
    if (url.pathname.startsWith('/rest/leads/'))
      return Response.json({
        leads: [
          {
            id: leadId,
            name: `Fallback ${number}`,
            htmlUrl: `https://app.nutshell.com/lead/${number}`,
            createdTime: { timestamp: created },
            links: {
              sources: [
                leadId === '77003-leads' ? '115-sources' : '35-sources',
              ],
              accounts: secondRep ? [] : ['8-accounts'],
              owner: '999-users',
            },
          },
        ],
        accounts: [{ id: '8-accounts', name: 'Northstar Outdoor' }],
        owners: [{ id: '999-users', emails: ['wrong-owner@example.test'] }],
      })
    expect(url.pathname).toBe('/rest/events')
    expect(url.searchParams.get('events')).toBe('assignments')
    return Response.json({
      meta: { next: null, previous: null },
      events: [
        {
          id: `${number}1-events`,
          createdTime: created,
          payloadType: 'leads',
          action: 'create',
          links: { payloads: [leadId] },
        },
        ...(assignmentReady
          ? [
              // The API can list a same-second replacement before its predecessor.
              {
                id: `${number}3-events`,
                createdTime: created + 1,
                payloadType: 'assignments',
                action: 'create',
                links: { payloads: [`${number}9-assignments`] },
              },
              {
                id: `${number}2-events`,
                createdTime: created + 1,
                payloadType: 'assignments',
                action: 'create',
                links: { payloads: [`${number}-assignments`] },
              },
            ]
          : []),
      ],
      payloads: [
        {
          id: `${number}-assignments`,
          type: 'assignments',
          links: {
            assignmentEntity: leadId,
            assigneeEntity: assignee.id,
            replacedEntityAssignment: null,
          },
        },
        {
          id: `${number}9-assignments`,
          type: 'assignments',
          links: {
            assignmentEntity: leadId,
            assigneeEntity: replacementAssignee.id,
            replacedEntityAssignment: `${number}-assignments`,
          },
        },
      ],
      assigneeEntity: [
        {
          ...assignee,
          type: 'users',
        },
        {
          ...replacementAssignee,
          type: 'users',
        },
      ],
    })
  }
  const processBatch = () => processLeadNotifications({ config, fetcher })
  try {
    await pool.query(
      'INSERT INTO "User" (id,email,role) VALUES ($1,$2,$3),($4,$5,$3)',
      [
        'notification-alpha',
        'Alpha@example.test',
        'user',
        'notification-beta',
        'not-matched-yet@example.test',
      ],
    )
    await signIn(context, 'notification-alpha')
    await signIn(other, 'notification-beta')
    for (const number of [77001, 77002, 77003, 77004]) {
      const response = await context.request.post(
        '/api/webhooks/nutshell?token=playwright-nutshell-webhook-local-only',
        {
          data: {
            events: [
              {
                id: `${number}-events`,
                payloadType: 'leads',
                action: 'create',
                links: { payloads: [`${number}-leads`] },
              },
            ],
          },
        },
      )
      expect(response.status()).toBe(202)
    }
    await processBatch()
    expect(
      (await (await context.request.get('/api/lead-notifications')).json())
        .notifications,
    ).toEqual([])
    assignmentReady = true
    await pool.query(
      "UPDATE nutshell_webhook_inbox SET next_attempt_at=now() - interval '1 second' WHERE lead_id LIKE '7700%-leads'",
    )
    await Promise.all([processBatch(), processBatch()])
    const list = await (
      await context.request.get('/api/lead-notifications')
    ).json()
    expect(list.notifications).toMatchObject([
      {
        id: '77001-leads',
        companyName: 'Northstar Outdoor',
        leadUrl: 'https://app.nutshell.com/lead/77001',
      },
    ])
    expect(list.notifications).toHaveLength(1)
    expect(
      (await (await other.request.get('/api/lead-notifications')).json())
        .notifications,
    ).toEqual([])
    await pool.query('UPDATE "User" SET email=$1 WHERE id=$2', [
      'beta@example.test',
      'notification-beta',
    ])
    await pool.query(
      "UPDATE nutshell_webhook_inbox SET next_attempt_at=now() - interval '1 second' WHERE lead_id='77002-leads'",
    )
    await processLeadNotifications({
      config,
      fetcher: async () => {
        throw new Error('Frozen identity retry must not depend on CRM')
      },
    })
    expect(
      (await (await other.request.get('/api/lead-notifications')).json())
        .notifications,
    ).toMatchObject([{ id: '77002-leads', companyName: 'Fallback 77002' }])
    expect(
      (
        await other.request.post('/api/lead-notifications/77001-leads/clear')
      ).status(),
    ).toBe(404)
    await page.goto('/issues')
    await expect(
      page.getByRole('link', { name: /Northstar Outdoor/ }),
    ).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Clear Northstar Outdoor' }).click()
    await expect(
      page.getByRole('link', { name: /Northstar Outdoor/ }),
    ).toHaveCount(0)
    await pool.query(
      "INSERT INTO nutshell_webhook_inbox(event_id,lead_id) VALUES ('770019-events','77001-leads')",
    )
    await processBatch()
    await context.clearCookies()
    expect(
      (await context.request.get('/api/lead-notifications')).status(),
    ).toBe(401)
    expect(
      (
        await context.request.post('/api/lead-notifications/77001-leads/clear')
      ).status(),
    ).toBe(401)
    await signIn(context, 'notification-alpha')
    expect(
      (await (await context.request.get('/api/lead-notifications')).json())
        .notifications,
    ).toEqual([])
    await page.reload()
    await expect(
      page
        .getByRole('region', { name: 'Contact Us leads' })
        .getByRole('listitem'),
    ).toHaveCount(0)
    // Clearing one account never clears another account's backlog.
    await other.clearCookies()
    expect((await other.request.get('/api/lead-notifications')).status()).toBe(
      401,
    )
    await signIn(other, 'notification-beta')
    expect(
      (await (await other.request.get('/api/lead-notifications')).json())
        .notifications,
    ).toHaveLength(1)
  } finally {
    await other.close()
    await pool.query(
      "DELETE FROM lead_notifications WHERE id LIKE '7700%-leads'",
    )
    await pool.query(
      "DELETE FROM nutshell_webhook_inbox WHERE lead_id LIKE '7700%-leads'",
    )
    await pool.query(
      "DELETE FROM \"User\" WHERE id IN ('notification-alpha','notification-beta')",
    )
    await pool.end()
  }
})
