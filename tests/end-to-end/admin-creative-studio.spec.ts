import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { baseUrl, jwtSecret } from './environment'

test('admin edits the wizard system prompt and restores the original in one click', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000)
  const token = await new SignJWT({ userId: 'e2e-studio-admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret))
  await context.addCookies([{ name: 'auth_token', value: token, url: baseUrl }])
  // Other admin widgets are unrelated; prompt reads/writes use the real API and disposable DB.
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/admin/art-wizard') return route.continue()
    if (path === '/api/issues') return route.fulfill({ json: { issues: [] } })
    if (path.endsWith('/usage')) return route.fulfill({ json: null })
    if (path === '/api/twilio-token')
      return route.fulfill({
        status: 503,
        json: { error: 'Telephony disabled in browser tests' },
      })
    if (path === '/api/taskrouter/worker-status')
      return route.fulfill({ json: { status: 'offline', success: true } })
    return route.fulfill({ json: {} })
  })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Creative Studio' }).click()
  const editor = page.getByRole('textbox', {
    name: 'Mockup Wizard system prompt',
  })
  await expect(editor).toHaveValue(
    /^You are the Billboard Source Mockup Wizard/,
  )
  await expect(page.getByText('Using the original prompt.')).toBeVisible()
  const original = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(original.isDefault).toBe(true)
  await page.getByText('Tool instructions', { exact: true }).click()
  await expect(
    page.getByText(original.instructions[0].text, { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(1)

  const custom =
    'You are the Billboard Source Mockup Wizard. Ask only three questions, then generate the billboard.'
  await editor.fill(custom)
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click()
  await expect(
    page.getByText(
      'Prompt saved. New wizard conversations will use these instructions.',
    ),
  ).toBeVisible()
  const saved = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(saved.prompt).toBe(custom)
  expect(saved.isDefault).toBe(false)
  expect(saved.instructions).toEqual(original.instructions)

  const denied = await context.request.put('/api/admin/art-wizard', {
    data: { prompt: 'Unwanted replacement', instructions: [] },
  })
  expect(denied.status()).toBe(400)

  await page.reload()
  await page.getByRole('tab', { name: 'Creative Studio' }).click()
  await expect(editor).toHaveValue(custom)
  await expect(page.getByText('Using a customized prompt.')).toBeVisible()
  await page.getByText('Tool instructions', { exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('admin-prompt-desktop.png'),
    fullPage: true,
  })

  await page
    .getByRole('button', { name: 'Reset to original prompt', exact: true })
    .click()
  await expect(
    page.getByText(
      'Original prompt restored. New wizard conversations will use it.',
    ),
  ).toBeVisible()
  await expect(editor).toHaveValue(original.prompt)
  const restored = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(restored.isDefault).toBe(true)
  expect(restored.prompt).toBe(original.prompt)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('New image frame', { exact: true }).click()
  await expect(
    page.getByText(original.instructions[1].text, { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('admin-prompt-mobile.png'),
    fullPage: true,
  })
})
