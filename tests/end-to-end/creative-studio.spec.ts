import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { expect, test as base, type Locator, type Page } from 'playwright/test'
import { baseUrl, jwtSecret, userId } from './environment'
import { composeMockup } from '../../lib/mockup/template'
import type { MockupState } from '../../lib/mockup/state'

const questions = [
  'What is the advertiser’s name?',
  'What is the advertiser’s website?',
  'What is the main goal of this billboard?',
  'What city, market, or audience is this billboard targeting?',
  'What product, service, event, or message should the billboard focus on?',
  'Is there any required text that must appear on the billboard?',
  'What tone should the design have?',
]
const answers = [
  'Example AI',
  'https://example.com',
  'Awareness',
  'Denver',
  'AI Integration',
  'website and website content',
  'Professional',
]
const brand = { website: 'https://example.com', logo: null, receipt: null }
const wizardError =
  'The wizard could not respond. Your conversation and selected image are unchanged. Please try again.'
const image = {
  id: '11111111-1111-4111-8111-111111111111',
  advertiser: 'Example AI',
  receipt: 'test-receipt',
  dataUrl: await composeMockup(
    `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/billboard.jpg', import.meta.url)).toString('base64')}`,
    'bulletin',
  ),
  posterDataUrl: await composeMockup(
    `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/poster.jpg', import.meta.url)).toString('base64')}`,
    'poster',
  ),
}
const revisedImage = {
  ...image,
  id: '22222222-2222-4222-8222-222222222222',
  dataUrl: await composeMockup(
    `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/revised-billboard.jpg', import.meta.url)).toString('base64')}`,
    'bulletin',
  ),
  posterDataUrl: await composeMockup(
    `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/revised-poster.jpg', import.meta.url)).toString('base64')}`,
    'poster',
  ),
}

/** Exercise duplicate commentary/final text and finish metadata from the AI SDK stream. */
function wizardStream(turn: {
  reply: string
  image?: unknown
  brand?: unknown
  error?: string
}) {
  const chunks: Record<string, unknown>[] = [
    { type: 'start' },
    {
      type: 'text-start',
      id: 'commentary',
      providerMetadata: { openai: { phase: 'commentary' } },
    },
    { type: 'text-delta', id: 'commentary', delta: turn.reply },
    { type: 'text-end', id: 'commentary' },
    {
      type: 'text-start',
      id: 't',
      providerMetadata: { openai: { phase: 'final_answer' } },
    },
    ...turn.reply.split(/(?<= )/).map((delta) => ({
      type: 'text-delta',
      id: 't',
      delta,
    })),
  ]
  if (turn.error) chunks.push({ type: 'error', errorText: turn.error })
  else
    chunks.push(
      { type: 'text-end', id: 't' },
      {
        type: 'finish',
        messageMetadata: {
          image: turn.image ?? null,
          brand: turn.brand ?? null,
        },
      },
    )
  return {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
    body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''),
  }
}

type Wizard = {
  replies: Parameters<typeof wizardStream>[0][]
  requests: (Pick<
    MockupState,
    'messages' | 'image' | 'brand' | 'attachments'
  > & {
    leadContext: string
  })[]
}

const test = base.extend<{ wizard: Wizard }>({
  wizard: async ({ page, context }, provide) => {
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
    const wizard: Wizard = { replies: [], requests: [] }
    const unexpected: string[] = []
    await page.route('**/api/**', (route) => {
      unexpected.push(new URL(route.request().url()).pathname)
      return route.abort()
    })
    // Real local authentication/session; only external services are mocked.
    await page.route('**/api/mockup/session', (route) => route.continue())
    for (const [path, response] of Object.entries({
      '/api/taskrouter/worker-status': {
        json: { status: 'offline', success: true },
      },
      '/api/workers/available': { json: { workers: [] } },
      '/api/twilio/client-events': { status: 204 },
      '/api/twilio-token': {
        status: 503,
        json: { error: 'Telephony disabled in browser tests' },
      },
    })) {
      await page.route(`**${path}`, (route) => route.fulfill(response))
    }
    await page.route('**/api/mockup/chat', (route) => {
      wizard.requests.push(route.request().postDataJSON())
      const reply = wizard.replies.shift()
      expect(reply, 'Unexpected wizard request').toBeDefined()
      return route.fulfill(wizardStream(reply!))
    })
    await page.route(
      (url) => /^https?:$/.test(url.protocol) && url.origin !== baseUrl,
      (route) => route.abort(),
    )
    await page.addLocatorHandler(
      page.getByRole('button', { name: 'Dismiss announcement' }),
      (dismiss) => dismiss.click(),
    )
    await provide(wizard)
    expect(unexpected).toEqual([])
    expect(
      wizard.replies,
      'Every scripted response should be exercised',
    ).toHaveLength(0)
  },
})

async function openStudio(page: Page, placement = 'Form views') {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/dashboard')
  await page
    .getByRole('tablist', { name: placement })
    .getByRole('tab', { name: 'Creative Studio' })
    .click()
  const studio = page.getByRole('region', {
    name: 'Creative Studio',
    exact: true,
  })
  await expect(
    studio.getByRole('textbox', { name: 'Message', exact: true }),
  ).toBeEditable()
  return studio
}

async function send(studio: Locator, text: string) {
  const message = studio.getByRole('textbox', { name: 'Message', exact: true })
  await message.fill(text)
  await message.press('Enter')
  await expect(message).toHaveValue('')
  await expect(message).toBeEditable()
  await expect(message).toBeFocused()
}

async function chooseFile(
  page: Page,
  studio: Locator,
  file: {
    name: string
    mimeType: string
    buffer: Buffer
  },
) {
  await studio
    .getByRole('button', { name: 'Add attachment', exact: true })
    .click()
  const chooser = page.waitForEvent('filechooser')
  await page
    .getByRole('menuitem', { name: 'Add photos & files', exact: true })
    .click()
  await (await chooser).setFiles(file)
}

async function expectArtworkSize(image: Locator) {
  await expect(image).toHaveJSProperty('naturalWidth', 1224)
  await expect(image).toHaveJSProperty('naturalHeight', 1584)
  const renderedRatio = await image.evaluate((element) => {
    const style = getComputedStyle(element)
    return (
      (element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)) /
      (element.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom))
    )
  })
  expect(renderedRatio).toBeCloseTo(1224 / 1584, 1)
}

test('wizard generates both formats, downloads, recovers a revision, survives refresh, and resets', async ({
  page,
  wizard,
}) => {
  // Cold compilation is included only once; individual assertion budgets stay unchanged.
  test.setTimeout(120_000)
  wizard.replies.push(
    ...questions.map((reply) => ({ reply })),
    { reply: 'Here is your billboard mockup.', image, brand },
    { reply: 'Adjusting the ', error: wizardError },
    { reply: 'Here is the revised mockup.', image: revisedImage },
    { reply: questions[0] },
  )
  const studio = await openStudio(page)
  const message = studio.getByRole('textbox', { name: 'Message', exact: true })
  await expect(
    studio.getByText('Enter “Start” to begin.', { exact: false }),
  ).toBeVisible()
  await expect(message).toHaveAttribute('placeholder', 'Enter Start to begin…')
  await expect(
    studio.getByRole('button', { name: 'Answer from form', exact: true }),
  ).toBeDisabled()
  await expect(studio.getByRole('log')).toBeEmpty()
  expect(wizard.requests).toHaveLength(0)
  await send(studio, 'Start')
  const history: MockupState['messages'] = [{ role: 'user', text: 'Start' }]
  for (const [index, answer] of answers.entries()) {
    await expect(
      studio.getByRole('log').getByText(questions[index], { exact: false }),
    ).toHaveCount(1)
    history.push(
      { role: 'assistant', text: questions[index] },
      { role: 'user', text: answer },
    )
    await send(studio, answer)
    expect(wizard.requests.at(-1)).toMatchObject({
      messages: history,
      image: null,
      brand: null,
      attachments: [],
      leadContext: '',
    })
  }
  const selected = studio.getByRole('img', {
    name: 'Bulletin advertisement for Example AI',
  })
  const poster = studio.getByRole('img', {
    name: 'Poster advertisement for Example AI',
  })
  await expect(selected).toHaveAttribute('src', image.dataUrl)
  await expect(poster).toHaveAttribute('src', image.posterDataUrl)
  await expect(
    studio.getByText(
      'Concept only · Check text and brand details before sharing.',
    ),
  ).toBeVisible()
  await expect(
    studio.getByRole('button', {
      name: 'Add to existing Nutshell lead',
      exact: true,
    }),
  ).toHaveCount(0)
  await expect(
    studio.getByRole('link', { name: 'Download poster', exact: true }),
  ).toHaveAttribute('href', image.posterDataUrl)
  const download = studio.getByRole('link', {
    name: 'Download bulletin',
    exact: true,
  })
  await expect(download).toHaveAttribute('href', image.dataUrl)
  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const downloaded = await downloadEvent
  expect(downloaded.suggestedFilename()).toBe(
    `billboard-bulletin-${image.id}.jpg`,
  )
  expect(await downloaded.failure()).toBeNull()

  await message.fill('Make the headline larger')
  await studio.getByRole('button', { name: 'Send message' }).click()
  await expect(studio.getByRole('alert')).toContainText(wizardError)
  await expect(studio.getByRole('log')).not.toContainText('Adjusting the')
  await expect(studio.getByRole('log')).not.toContainText(
    'Make the headline larger',
  )
  await expect(message).toHaveValue('Make the headline larger')
  await expect(selected).toHaveAttribute('src', image.dataUrl)
  const failedRequest = wizard.requests.at(-1)
  expect(failedRequest).toMatchObject({ image, brand, attachments: [] })
  await studio.getByRole('button', { name: 'Send message' }).click()
  await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
  await expect(poster).toHaveAttribute('src', revisedImage.posterDataUrl)
  await expect(studio.getByRole('alert')).toHaveCount(0)
  expect(wizard.requests.at(-1)).toEqual(failedRequest)

  await page.reload()
  await page
    .getByRole('tablist', { name: 'Form views' })
    .getByRole('tab', { name: 'Creative Studio' })
    .click()
  await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
  await expect(poster).toHaveAttribute('src', revisedImage.posterDataUrl)
  await expect(download).toHaveAttribute(
    'download',
    `billboard-bulletin-${revisedImage.id}.jpg`,
  )
  await studio
    .getByRole('button', { name: 'Start Mockup', exact: true })
    .click()
  await expect(selected).toHaveCount(0)
  await expect(poster).toHaveCount(0)
  await expect(studio.getByRole('log')).toContainText(questions[0])
  await expect(studio.getByRole('log')).not.toContainText(
    'Here is the revised mockup.',
  )
  expect(wizard.requests.at(-1)).toMatchObject({
    messages: [{ role: 'user', text: 'Start' }],
    image: null,
    brand: null,
    attachments: [],
  })
})

test('Lead tools shares unsent drafts, form context, and revision failures with full Studio', async ({
  page,
  wizard,
}) => {
  wizard.replies.push(
    { reply: questions[1] },
    { reply: 'Here is your billboard mockup.', image, brand },
    { reply: 'Adjusting the ', error: wizardError },
    { reply: 'Here is the revised mockup.', image: revisedImage },
  )
  const studio = await openStudio(page, 'Lead tools')
  await page
    .getByPlaceholder('Company Name', { exact: true })
    .fill('Example AI')
  const tools = page.getByRole('tablist', { name: 'Lead tools' })
  const views = page.getByRole('tablist', { name: 'Form views' })
  const tab = tools.getByRole('tab', { name: 'Creative Studio' })
  const draft = studio.getByRole('textbox', { name: 'Message', exact: true })
  const answerFromForm = studio.getByRole('button', {
    name: 'Answer from form',
    exact: true,
  })
  await expect(answerFromForm).toBeEnabled()
  await draft.fill('Unsaved website draft')
  await expect(answerFromForm).toBeDisabled()
  await tools.getByRole('tab', { name: 'Pricing', exact: true }).click()
  await tab.click()
  await expect(draft).toHaveValue('Unsaved website draft')
  await views.getByRole('tab', { name: 'Creative Studio' }).click()
  await expect(draft).toHaveValue('Unsaved website draft')
  await draft.fill('Edited in full Studio')
  await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
  await tab.click()
  await expect(draft).toHaveValue('Edited in full Studio')
  await tools.getByRole('tab', { name: 'Google Map', exact: true }).click()
  await expect(
    tools.getByRole('tab', { name: 'Google Map', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await tab.click()
  await expect(draft).toHaveValue('Edited in full Studio')
  expect(wizard.requests).toHaveLength(0)
  await draft.fill('')
  await answerFromForm.click()
  await expect(studio.getByRole('log')).toContainText(questions[1])
  await expect(studio.getByRole('log')).not.toContainText(questions[0])
  expect(wizard.requests[0]).toMatchObject({
    leadContext: 'Advertiser: Example AI',
    messages: [
      {
        role: 'user',
        text: expect.stringContaining('Use my current lead form'),
      },
    ],
  })
  await expect(studio.getByRole('log')).toContainText('Advertiser: Example AI')
  await send(studio, answers[1])
  const selected = studio.getByRole('img', {
    name: 'Bulletin advertisement for Example AI',
  })
  await expect(selected).toHaveAttribute('src', image.dataUrl)
  await draft.fill('Make the headline larger')
  await studio.getByRole('button', { name: 'Send message' }).click()
  await expect(studio.getByRole('alert')).toContainText(wizardError)
  for (const destination of ['Creative Studio', 'Lead Form & Pricing']) {
    await views.getByRole('tab', { name: destination }).click()
    if (destination === 'Lead Form & Pricing') await tab.click()
    await expect(draft).toHaveValue('Make the headline larger')
    await expect(studio.getByRole('alert')).toContainText(wizardError)
    await expect(selected).toHaveAttribute('src', image.dataUrl)
  }
  await studio.getByRole('button', { name: 'Send message' }).click()
  await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
  await expect(studio.getByRole('alert')).toHaveCount(0)
  expect(wizard.requests.at(-1)).toEqual(wizard.requests.at(-2))
})

test('reference picker validates files and accepts PNG and dropped JPEG images', async ({
  page,
  context,
  wizard,
}) => {
  const studio = await openStudio(page)
  for (const [name, mimeType, buffer, error] of [
    ['bad.html', 'text/html', Buffer.from('<h1>bad</h1>'), 'PNG, JPEG, or PDF'],
    [
      'large.png',
      'image/png',
      Buffer.alloc(10 * 1024 * 1024 + 1),
      'no larger than 10 MB',
    ],
    [
      'broken.pdf',
      'application/pdf',
      Buffer.from('%PDF-broken'),
      'Could not prepare broken.pdf',
    ],
  ] as const) {
    await chooseFile(page, studio, { name, mimeType, buffer })
    await expect(studio.getByRole('alert')).toContainText(error)
  }
  const fixture = await context.newPage()
  await fixture.setViewportSize({ width: 600, height: 300 })
  await fixture.setContent(
    '<html><body style="margin:0;background:#c8e5f5">ALPINE</body></html>',
  )
  const logo = await fixture.screenshot({ type: 'png' })
  const photo = await fixture.screenshot({ type: 'jpeg' })
  await fixture.close()
  await chooseFile(page, studio, {
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: logo,
  })
  await expect(
    studio.getByRole('img', { name: 'logo.png', exact: true }),
  ).toBeVisible()
  await expect(studio.getByRole('alert')).toHaveCount(0)
  await chooseFile(page, studio, {
    name: 'extra.png',
    mimeType: 'image/png',
    buffer: logo,
  })
  await expect(studio.getByRole('alert')).toContainText(
    'Use one reference file',
  )
  await studio.getByRole('button', { name: 'Remove logo.png' }).click()
  await expect(
    studio.getByRole('img', { name: 'logo.png', exact: true }),
  ).toHaveCount(0)
  const dropped = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File([Uint8Array.from(bytes)], 'photo.jpg', { type: 'image/jpeg' }),
      )
      return transfer
    },
    [...photo],
  )
  await studio
    .getByRole('textbox', { name: 'Message', exact: true })
    .dispatchEvent('drop', { dataTransfer: dropped })
  await dropped.dispose()
  await expect(
    studio.getByRole('img', { name: 'photo.jpg', exact: true }),
  ).toBeVisible()
  await studio.getByRole('button', { name: 'Remove photo.jpg' }).click()
  await expect(
    studio.getByRole('img', { name: 'photo.jpg', exact: true }),
  ).toHaveCount(0)
  expect(wizard.requests).toHaveLength(0)
})

test('PDF search retries, selects the matching page, sends it to the wizard, and preserves it on refresh', async ({
  page,
  context,
  wizard,
}) => {
  wizard.replies.push(
    { reply: questions[0] },
    { reply: 'Here is your billboard mockup.', image, brand },
    { reply: 'Here is the revised mockup.', image: revisedImage },
    { reply: questions[0] },
  )
  const studio = await openStudio(page, 'Lead tools')
  await send(studio, 'Start')
  const fixture = await context.newPage()
  await fixture.setContent(
    '<html><style>@page {margin:0} body {margin:0} section {height:300px;break-after:page;font:32px sans-serif}</style><body><section style="background:#ddd">Brand guidelines</section><section><div style="height:200px;background:#c8e5f5">Mountain background</div><div style="height:100px;background:#45855a"></div></section><section style="background:#fdb565">ALPINE LOGO</section></body></html>',
  )
  const pdf = await fixture.pdf({
    width: '600px',
    height: '300px',
    printBackground: true,
  })
  await fixture.close()
  let searches = 0
  await page.route('**/api/mockup/search-pdf', (route) => {
    const body = route.request().postDataJSON()
    expect(
      body.pages.map((page: { pageNumber: number }) => page.pageNumber),
    ).toEqual([1, 2, 3])
    expect(
      new Set(body.pages.map((page: { dataUrl: string }) => page.dataUrl)).size,
    ).toBe(3)
    expect(
      body.pages.every(
        (page: { dataUrl: string }) =>
          page.dataUrl.startsWith('data:image/jpeg;base64,') &&
          page.dataUrl.length <= 60_000,
      ),
    ).toBe(true)
    if (++searches === 1)
      return route.fulfill({
        status: 502,
        json: { error: 'Could not search the PDF. Please try again.' },
      })
    const pageNumber =
      body.query === 'missing logo'
        ? null
        : body.query === 'company logo'
          ? 3
          : 2
    return route.fulfill({
      json: {
        pageNumber,
        reason: pageNumber
          ? `Matching artwork found on page ${pageNumber}.`
          : 'No matching image found.',
      },
    })
  })
  await chooseFile(page, studio, {
    name: 'scene.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  })
  const cover = studio.getByRole('img', {
    name: 'scene.pdf (PDF page 1 of 3)',
    exact: true,
  })
  await expect(cover).toBeVisible()
  const query = studio.getByRole('textbox', {
    name: 'Find a logo or background in this PDF',
  })
  const search = studio.getByRole('button', { name: 'Search PDF', exact: true })
  const preview = studio.getByRole('img', {
    name: 'scene.pdf (PDF page 2 of 3) · Selected for: mountain background',
    exact: true,
  })
  await query.fill('mountain background')
  await search.click()
  await expect(studio.getByRole('alert')).toContainText(
    'Could not search the PDF',
  )
  await expect(cover).toBeVisible()
  await search.click()
  await expect(preview).toBeVisible()
  await expect(studio.getByRole('alert')).toHaveCount(0)
  await query.fill('missing logo')
  await query.press('Enter')
  await expect(
    studio.getByText('No matching image found.', { exact: true }),
  ).toBeVisible()
  await expect(preview).toBeVisible()
  await query.fill('company logo')
  await search.click()
  await expect(
    studio.getByRole('img', {
      name: 'scene.pdf (PDF page 3 of 3) · Selected for: company logo',
      exact: true,
    }),
  ).toBeVisible()
  await query.fill('mountain background')
  await search.click()
  await expect(preview).toBeVisible()
  const colors = await preview.evaluate((element) => {
    const image = element as HTMLImageElement
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [
      [...context.getImageData(550, 100, 1, 1).data].slice(0, 3),
      [...context.getImageData(5, canvas.height - 5, 1, 1).data].slice(0, 3),
    ]
  })
  // Independently known page-two colors distinguish it from the cover and logo page.
  for (const [index, pixel] of [
    [200, 229, 245],
    [69, 133, 90],
  ].entries())
    for (const [channel, value] of pixel.entries())
      expect(Math.abs(colors[index][channel] - value)).toBeLessThan(4)

  await send(studio, 'Example AI')
  const references = wizard.requests.at(-1)!.attachments
  expect(references).toHaveLength(1)
  expect(references[0]).toMatchObject({
    sourceType: 'application/pdf',
    pageNumber: 2,
    pageCount: 3,
    searchQuery: 'mountain background',
  })
  expect(references[0].dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
  expect(references[0].dataUrl.length).toBeLessThanOrEqual(400_000)
  await send(studio, 'Keep the mountain background')
  expect(wizard.requests.at(-1)).toMatchObject({
    image,
    brand,
    attachments: references,
  })

  // The PDF controls must remain usable in the narrow composer, not just desktop.
  await page.setViewportSize({ width: 390, height: 844 })
  await preview.evaluate((element) =>
    element.scrollIntoView({ block: 'center' }),
  )
  await search.click({ trial: true })
  await page.reload()
  await page
    .getByRole('tablist', { name: 'Lead tools' })
    .getByRole('tab', { name: 'Creative Studio' })
    .click()
  await expect(preview).toBeVisible()
  await expect(
    studio.getByText(
      'The selected page is preserved. Remove and reattach the PDF to search again after a refresh.',
    ),
  ).toBeVisible()
  await studio
    .getByRole('button', { name: 'Start Mockup', exact: true })
    .click()
  await expect(
    studio.getByRole('button', { name: 'Remove scene.pdf' }),
  ).toHaveCount(0)
  await expect(studio.getByRole('log')).toContainText(questions[0])
  expect(wizard.requests.at(-1)!.attachments).toEqual([])
})

test('lead attachment recovery retries the original files after revision and refresh without creating a second lead', async ({
  page,
  wizard,
}) => {
  wizard.replies.push(
    { reply: 'Here is your billboard mockup.', image, brand },
    { reply: 'Here is the revised mockup.', image: revisedImage },
  )
  const studio = await openStudio(page, 'Lead tools')
  await page
    .getByPlaceholder('Company Name', { exact: true })
    .fill('Example AI')
  await send(studio, 'Create a billboard for Example AI')
  const selected = studio.getByRole('img', {
    name: 'Bulletin advertisement for Example AI',
  })
  await expect(selected).toHaveAttribute('src', image.dataUrl)
  await expect(
    page.getByText(
      'Nutshell will include the bulletin and poster for Example AI.',
    ),
  ).toBeVisible()
  let submitted: unknown
  await page.route('**/api/nutshell/create-lead', (route) => {
    submitted = route.request().postDataJSON()
    return route.fulfill({
      status: 400,
      json: { error: 'Complete the required fields' },
    })
  })
  await page.getByRole('button', { name: 'Nutshell', exact: true }).click()
  await expect
    .poll(() => submitted)
    .toMatchObject({ entityName: 'Example AI', mockupImage: image })
  let createdLeads = 0
  await page.route('**/api/nutshell/create-lead', (route) => {
    createdLeads++
    expect(route.request().postDataJSON()).toMatchObject({
      entityName: 'Example AI',
      mockupImage: image,
    })
    return route.fulfill({
      json: {
        success: true,
        leadId: 42,
        imageAttachmentFailed: true,
        imageAttachmentReceipt: 'lead-42-receipt',
      },
    })
  })
  let attached: unknown
  await page.route('**/api/mockup/leads', (route) => {
    expect(route.request().method()).toBe('POST')
    attached = route.request().postDataJSON()
    return route.fulfill({ json: { success: true } })
  })
  await page.getByRole('button', { name: 'Nutshell', exact: true }).click()
  const retry = studio.getByRole('button', { name: 'Retry image attachment' })
  await expect(retry).toBeVisible()
  await send(studio, 'Make the headline larger')
  await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
  await page.reload()
  const tab = page
    .getByRole('tablist', { name: 'Lead tools' })
    .getByRole('tab', { name: 'Creative Studio' })
  await tab.click()
  await retry.click()
  const dialog = page.getByRole('dialog', {
    name: 'Send this mockup to Nutshell',
  })
  await expect(dialog.getByText('Confirm: Example AI (#42)')).toBeVisible()
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(
    dialog.getByRole('img', { name: 'Bulletin for Example AI to attach' }),
  ).toHaveAttribute('src', image.dataUrl)
  await expect(
    dialog.getByRole('img', { name: 'Poster for Example AI to attach' }),
  ).toHaveAttribute('src', image.posterDataUrl)
  await dialog
    .getByRole('button', { name: 'Confirm & attach images', exact: true })
    .click()
  await expect(dialog).toBeHidden()
  await expect(retry).toHaveCount(0)
  await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
  expect(attached).toEqual({
    leadId: 42,
    confirmedLeadId: 42,
    receipt: 'lead-42-receipt',
    image,
  })
  expect(createdLeads).toBe(1)

  // Simulate a legacy persisted session: never guess an unverified attachment target.
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('billboard-active-mockup')!)
    delete saved.state.lastLead.receipt
    saved.state.attachmentFailed = true
    sessionStorage.setItem('billboard-active-mockup', JSON.stringify(saved))
  })
  await page.reload()
  await tab.click()
  await page.setViewportSize({ width: 390, height: 844 })
  await retry.click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Do not resubmit the Lead Form.',
  )
  await expect(
    dialog.getByRole('button', {
      name: 'Confirm & attach images',
      exact: true,
    }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(createdLeads).toBe(1)
})

test('dashboard tools and both artwork formats fit desktop and mobile layouts', async ({
  page,
  wizard,
}) => {
  wizard.replies.push({ reply: 'Here is your billboard mockup.', image, brand })
  const studio = await openStudio(page, 'Lead tools')
  await expect(page.getByText('GPP3', { exact: true })).toBeVisible()
  const views = page.getByRole('tablist', { name: 'Form views' })
  await expect(views.getByRole('tab')).toHaveText([
    'Lead Form & PricingForm',
    'Google MapMap',
    'Inventory ExplorerInventory',
    'Proposals',
    'Creative StudioCreative Studio',
  ])
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
  await expect(
    page.getByRole('link', { name: 'Billboard Source AI.', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).click()
  await send(studio, 'Create a billboard for Example AI')
  const tools = page.getByRole('tablist', { name: 'Lead tools' })
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(tools).toBeVisible()
    await expect(async () => {
      for (const button of await tools.getByRole('tab').all()) {
        const fits = await button.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const text = document.createRange()
          text.selectNodeContents(element)
          return Array.from(text.getClientRects()).every(
            (rect) =>
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom,
          )
        })
        expect(fits, `${width}px: ${await button.textContent()}`).toBe(true)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    }).toPass({ timeout: 5000 })
    await expectArtworkSize(
      studio.getByRole('img', {
        name: 'Bulletin advertisement for Example AI',
      }),
    )
    await expectArtworkSize(
      studio.getByRole('img', { name: 'Poster advertisement for Example AI' }),
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const nutshell = page.getByRole('button', { name: 'Nutshell', exact: true })
  await nutshell.scrollIntoViewIfNeeded()
  await expect(
    tools.getByRole('tab', { name: 'Creative Studio' }),
  ).toBeInViewport()
  await expect(nutshell).toBeInViewport()
  await studio
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Simplify the headline')
  const sendButton = studio.getByRole('button', { name: 'Send message' })
  await sendButton.scrollIntoViewIfNeeded()
  await expect(sendButton).toBeInViewport({ ratio: 1 })
  await sendButton.click({ trial: true })
  await views.getByRole('tab', { name: 'Creative Studio' }).click()
  await expectArtworkSize(
    studio.getByRole('img', { name: 'Bulletin advertisement for Example AI' }),
  )
  await expectArtworkSize(
    studio.getByRole('img', { name: 'Poster advertisement for Example AI' }),
  )
})
