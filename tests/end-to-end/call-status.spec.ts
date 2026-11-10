import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { baseUrl, jwtSecret, userId } from './environment'

test('the site follows a cell call from ringing through answer and back to the queue', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  await context.grantPermissions(['notifications'])
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret))
  await context.addCookies([
    {
      name: 'auth_token',
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.origin !== baseUrl,
    (route) => route.abort(),
  )
  await page.route('**/api/twilio-token', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Simulated calling connection outage' },
    }),
  )
  await page.route('**/api/twilio/client-events', (route) =>
    route.fulfill({ status: 204 }),
  )
  await page.route('**/api/taskrouter/worker-status', (route) =>
    route.fulfill({ json: { status: 'available', success: true } }),
  )
  let call: null | {
    taskSid: string
    callSid: string
    callerFrom: string
    status: string
    channel: string | null
  } = null
  let offered = false
  let isRecipient = true
  await page.route('**/api/workers/available', (route) =>
    route.fulfill({
      json: {
        workers: [
          ...(offered
            ? [{ id: 'WK-next', name: 'Jason', status: 'available' }]
            : []),
          {
            id: 'WK-rep',
            name: 'Cory',
            status: call
              ? call.status === 'ringing'
                ? 'ringing'
                : 'busy'
              : 'available',
          },
          ...(!offered
            ? [{ id: 'WK-next', name: 'Jason', status: 'available' }]
            : []),
        ],
        currentCall: isRecipient ? call : null,
      },
    }),
  )
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Dismiss announcement' }),
    (button) => button.click(),
  )
  await page.goto('/dashboard')
  const roster = page.getByRole('status', { name: 'Round-robin call status' })
  const availability = page.getByRole('combobox', {
    name: 'Worker availability status',
  })
  await availability.click()
  await page.getByRole('option', { name: 'Available', exact: true }).click()
  await expect(availability).toContainText('Available')
  await expect(page.getByText('Cory')).toBeVisible()
  await expect(page.getByText('next', { exact: true })).toBeVisible()
  await expect(roster).toContainText(/1\s*Cory\s*next/)

  offered = true
  call = {
    taskSid: 'WT-call',
    callSid: 'CA-parent',
    callerFrom: '+13035550123',
    status: 'ringing',
    channel: null,
  }
  const ringingBadge = roster.getByRole('img', { name: 'Cory: ringing' })
  await expect(ringingBadge).toBeVisible({
    timeout: 10_000,
  })
  await expect(ringingBadge).toHaveText('Cory')
  await expect(roster).not.toContainText('Ringing')
  await expect(roster).toContainText(/1\s*Jason\s*next/)
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)
  await expect(page.getByText('Browser calling is reconnecting.')).toHaveCount(
    0,
  )
  // A disconnected browser must not display an Accept button that cannot work.
  await expect(
    page.getByRole('button', { name: 'Accept', exact: true }),
  ).toHaveCount(0)

  // Other viewers see who is ringing, without receiving the rep's caller details.
  isRecipient = false
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)
  await expect(ringingBadge).toBeVisible()
  isRecipient = true

  call = { ...call, status: 'answered', channel: 'cell' }
  const connectedBadge = roster.getByRole('img', { name: 'Cory: connected' })
  await expect(connectedBadge).toBeVisible()
  await expect(connectedBadge).toHaveText('Cory')
  await expect(roster).not.toContainText('On call')
  await expect(roster).not.toContainText('On cell')
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: /^On call$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Hang Up', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true }),
  ).toBeDisabled()

  // Mobile retains call status without the redundant routed-call notice.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)

  call = { ...call, channel: 'browser' }
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: /^On call$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Hang Up', exact: true }),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(connectedBadge).toBeVisible()

  call = null
  await expect(
    page.getByRole('status', { name: 'Your routed call' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true }),
  ).toBeEnabled()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(roster).not.toContainText('On cell')
  await expect(roster).not.toContainText('Ringing')
  await expect(roster).not.toContainText('In browser')
  await expect(roster).not.toContainText('On call')
  await expect(connectedBadge).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByText('📱 Caller: +13035550123')).toHaveCount(0)
})
