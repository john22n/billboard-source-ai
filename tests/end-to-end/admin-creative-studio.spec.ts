import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { baseUrl, jwtSecret } from './environment'

test('admin can inspect protected instructions and persist only the image prompt', async ({
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
  // Other admin widgets are unrelated; instruction reads/writes use the real API and disposable DB.
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
    name: 'Image-generation system prompt',
  })
  await expect(editor).toHaveValue(/^Create ONE finished/)
  const before = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  await page.getByText('Questionnaire extraction', { exact: true }).click()
  await expect(
    page.getByText(before.instructions[0].text, { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await editor.fill(
    'Use a restrained navy and orange palette with large readable type.',
  )
  await page.getByRole('button', { name: 'Save prompt', exact: true }).click()
  await expect(
    page.getByText('Prompt saved. New mockups will use these instructions.'),
  ).toBeVisible()
  const after = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(after.instructions).toEqual(before.instructions)
  expect(after.prompt).toBe(
    'Use a restrained navy and orange palette with large readable type.',
  )
  const denied = await context.request.put('/api/admin/art-wizard', {
    data: { prompt: 'Unwanted replacement', instructions: [] },
  })
  expect(denied.status()).toBe(400)
  await page.reload()
  await page.getByRole('tab', { name: 'Creative Studio' }).click()
  await expect(editor).toHaveValue(after.prompt)
  await page.getByText('Questionnaire extraction', { exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('admin-instructions-desktop.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('New image assembly', { exact: true }).click()
  await expect(
    page.getByText('Website logo available', { exact: false }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('admin-instructions-mobile.png'),
    fullPage: true,
  })
})
