import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { baseUrl, jwtSecret } from './environment'

test.beforeEach(async ({ context }) => {
  const token = await new SignJWT({ userId: 'e2e-studio-admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret))
  await context.addCookies([{ name: 'auth_token', value: token, url: baseUrl }])
})

test('admin changes face ratios without rewriting the system prompt, then saves and resets settings', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000)
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
  const ratio = (format: 'bulletin' | 'poster', axis: 'width' | 'height') =>
    page.getByRole('spinbutton', { name: `${format} ${axis}` })
  const save = page.getByRole('button', { name: 'Save settings', exact: true })
  const reset = page.getByRole('button', {
    name: 'Reset prompt and ratios',
    exact: true,
  })

  await expect(editor).toHaveValue(
    /^You are the Billboard Source Mockup Wizard/,
  )
  await expect(page.getByText('Using the original prompt.')).toBeVisible()
  const original = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(original.isDefault).toBe(true)
  const defaults = original.imageSettings
  expect(defaults).toEqual({
    bulletin: { width: 24, height: 7 },
    poster: { width: 13, height: 6 },
  })
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await expect(page.getByRole('spinbutton')).toHaveCount(4)
  await expect(ratio('bulletin', 'width')).toHaveValue('24')
  await expect(ratio('bulletin', 'height')).toHaveValue('7')
  await expect(ratio('poster', 'width')).toHaveValue('13')
  await expect(ratio('poster', 'height')).toHaveValue('6')
  await expect(save).toBeDisabled()
  await expect(reset).toBeDisabled()
  await page.getByText('Tool instructions', { exact: true }).click()
  await expect(
    page.getByText(original.instructions[0].text, { exact: true }),
  ).toBeVisible()

  const custom =
    'You are the Billboard Source Mockup Wizard. Ask only three questions, then generate the billboard.'
  const customSettings = {
    bulletin: { width: 48, height: 14 },
    poster: { width: 12, height: 5 },
  }
  await ratio('bulletin', 'width').fill('48')
  await ratio('bulletin', 'height').fill('14')
  await ratio('poster', 'width').fill('12')
  await ratio('poster', 'height').fill('5')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await save.click()
  await expect(
    page.getByText(
      'Settings saved. Subsequent wizard turns will use these instructions.',
    ),
  ).toBeVisible()
  await expect(save).toBeDisabled()
  const ratioOnly = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(ratioOnly.prompt).toBe(original.prompt)
  expect(ratioOnly.imageSettings).toEqual(customSettings)
  await expect(editor).toHaveValue(original.prompt)

  await editor.fill(custom)
  await save.click()
  await expect(
    page.getByText(
      'Settings saved. Subsequent wizard turns will use these instructions.',
    ),
  ).toBeVisible()
  const saved = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(saved.prompt).toBe(custom)
  expect(saved.isDefault).toBe(false)
  expect(saved.imageSettings).toEqual(customSettings)
  expect(saved.instructions).toEqual(original.instructions)

  const denied = await context.request.put('/api/admin/art-wizard', {
    data: { prompt: 'Unwanted replacement', instructions: [] },
  })
  expect(denied.status()).toBe(400)
  const portrait = await context.request.put('/api/admin/art-wizard', {
    data: {
      prompt: 'Unwanted replacement',
      imageSettings: { ...customSettings, poster: { width: 5, height: 12 } },
    },
  })
  expect(portrait.status()).toBe(400)
  expect((await portrait.json()).error).toMatch(/landscape face ratios/)
  const tooWide = await context.request.put('/api/admin/art-wizard', {
    data: {
      prompt: 'Unwanted replacement',
      imageSettings: { ...customSettings, bulletin: { width: 70, height: 10 } },
    },
  })
  expect(tooWide.status()).toBe(400)
  expect(
    (await (await context.request.get('/api/admin/art-wizard')).json())
      .imageSettings,
  ).toEqual(customSettings)

  await page.reload()
  await page.getByRole('tab', { name: 'Creative Studio' }).click()
  await expect(editor).toHaveValue(custom)
  await expect(ratio('bulletin', 'width')).toHaveValue('48')
  await expect(ratio('bulletin', 'height')).toHaveValue('14')
  await expect(ratio('poster', 'width')).toHaveValue('12')
  await expect(ratio('poster', 'height')).toHaveValue('5')
  await expect(page.getByText('Using saved settings.')).toBeVisible()

  // A non-landscape ratio is rejected in the UI and nothing is persisted.
  await ratio('poster', 'width').fill('5')
  await ratio('poster', 'height').fill('12')
  await save.click()
  await expect(
    page
      .getByRole('alert')
      .getByText(
        'Use a landscape face ratio greater than 1:1 and no wider than 6:1.',
      ),
  ).toBeVisible()
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  expect(
    (await (await context.request.get('/api/admin/art-wizard')).json())
      .imageSettings,
  ).toEqual(customSettings)
  await page.getByText('Tool instructions', { exact: true }).click()
  await page.screenshot({
    path: testInfo.outputPath('admin-image-settings-desktop.png'),
    fullPage: true,
  })

  await reset.click()
  await expect(
    page.getByText('Original system prompt and face ratios restored.'),
  ).toBeVisible()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Use a landscape face ratio' }),
  ).toHaveCount(0)
  await expect(editor).toHaveValue(original.prompt)
  await expect(ratio('bulletin', 'width')).toHaveValue('24')
  await expect(ratio('bulletin', 'height')).toHaveValue('7')
  await expect(ratio('poster', 'width')).toHaveValue('13')
  await expect(ratio('poster', 'height')).toHaveValue('6')
  await expect(reset).toBeDisabled()
  const restored = await (
    await context.request.get('/api/admin/art-wizard')
  ).json()
  expect(restored.isDefault).toBe(true)
  expect(restored.prompt).toBe(original.prompt)
  expect(restored.imageSettings).toEqual(defaults)

  await page.reload()
  await page.getByRole('tab', { name: 'Creative Studio' }).click()
  await expect(page.getByText('Using the original prompt.')).toBeVisible()
  await expect(ratio('bulletin', 'width')).toHaveValue('24')
  await expect(editor).toHaveValue(original.prompt)
  await page
    .getByRole('group', { name: 'Image generation settings', exact: true })
    .screenshot({
      path: testInfo.outputPath('admin-image-settings-default.png'),
    })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Output requirements', { exact: true }).click()
  await expect(
    page.getByText(original.instructions[1].text, { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('admin-image-settings-mobile.png'),
    fullPage: true,
  })
  await page
    .getByRole('group', { name: 'Image generation settings', exact: true })
    .screenshot({
      path: testInfo.outputPath('admin-image-settings-mobile-fields.png'),
    })
})

test('admin sees a storage error without a false access warning', async ({
  page,
}, testInfo) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/admin/art-wizard')
      return route.fulfill({
        status: 500,
        json: {
          error: 'Could not load Creative Studio instructions. Please retry.',
        },
      })
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
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Creative Studio' }).click()

  await expect(
    page
      .getByRole('alert')
      .getByText('Could not load Creative Studio instructions. Please retry.'),
  ).toBeVisible()
  await expect(page.getByText(/check your admin access/i)).toHaveCount(0)
  await expect(
    page.getByRole('textbox', { name: 'Mockup Wizard system prompt' }),
  ).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('admin-image-settings-storage-error.png'),
    fullPage: true,
  })
})
