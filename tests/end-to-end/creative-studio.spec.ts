import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { expect, test, type Locator } from 'playwright/test'
import { baseUrl, jwtSecret, userId } from './environment'

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
  dataUrl: `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/billboard.jpg', import.meta.url)).toString('base64')}`,
}
const revisedImage = {
  ...image,
  id: '22222222-2222-4222-8222-222222222222',
  dataUrl: `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/revised-billboard.jpg', import.meta.url)).toString('base64')}`,
}

/**
 * The chat route answers with an AI SDK UI message stream. Text arrives in
 * several deltas; the image and brand ride on the finish chunk's metadata.
 */
function wizardStream(turn: {
  reply: string
  image?: unknown
  brand?: unknown
  error?: string
}) {
  const words = turn.reply.split(/(?<= )/)
  const chunks: Record<string, unknown>[] = [
    { type: 'start' },
    { type: 'text-start', id: 't' },
    ...words.map((delta) => ({ type: 'text-delta', id: 't', delta })),
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

/** Page 2, not the gray cover or orange logo page, must supply the reference. */
function expectPageTwoColors(colors: number[][]) {
  const expected = [
    [200, 229, 245],
    [69, 133, 90],
  ]
  expected.forEach((pixel, index) =>
    pixel.forEach((value, channel) =>
      expect(Math.abs(colors[index][channel] - value)).toBeLessThan(4),
    ),
  )
}

function expectCompactImage(file: { dataUrl: string }) {
  expect(file.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
  expect(file.dataUrl.length).toBeLessThanOrEqual(400_000)
}

/** Answers each remaining wizard question from the shared script, one turn at a time. */
async function answerQuestions(
  studio: Locator,
  firstQuestion: number,
  afterAnswer: (index: number) => Promise<unknown>,
) {
  const message = studio.getByRole('textbox', { name: 'Message', exact: true })
  for (const [offset, answer] of answers.slice(firstQuestion).entries()) {
    const index = firstQuestion + offset
    await expect(studio.getByRole('log')).toContainText(questions[index])
    await message.fill(answer)
    await message.press('Enter')
    await expect(message).toHaveValue('')
    await expect(message).toBeFocused()
    await expect(message).toBeEditable()
    await afterAnswer(index)
  }
}

for (const placement of ['Form views', 'Lead tools']) {
  test(`Creative Studio in ${placement} chats through the wizard, renders a mockup, retries a revision, and resets`, async ({
    page,
    context,
  }, testInfo) => {
    // The first dashboard navigation also compiles Next's client bundle on CI.
    test.setTimeout(60_000)
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

    type Message = { role: 'user' | 'assistant'; text: string }
    const chats: Record<string, unknown>[] = []
    let history: Message[] = []
    let answered = 0
    let revisions = 0
    const unexpected: string[] = []
    await page.route('**/api/**', async (route) => {
      unexpected.push(new URL(route.request().url()).pathname)
      return route.abort()
    })
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
    // The wizard is mocked: it replies with the next scripted question, then an image.
    await page.route('**/api/mockup/chat', async (route) => {
      const body = route.request().postDataJSON()
      chats.push(body)
      const messages: Message[] = body.messages
      const latest = messages.at(-1)!
      expect(latest.role).toBe('user')
      const starting = /^Start(\n|$)/.test(latest.text)
      if (starting) {
        // "Start" always begins a fresh conversation without the previous mockup.
        expect(messages).toHaveLength(1)
        expect(body.image).toBeNull()
        expect(body.brand).toBeNull()
        history = []
        answered = latest.text.includes('Advertiser: Example AI') ? 1 : 0
      } else {
        expect(messages.slice(0, -1)).toEqual(history)
        expect(
          body.attachments.map((file: { name: string }) => file.name),
        ).toEqual(['scene.pdf'])
        expect(body.attachments[0]).toMatchObject({
          pageNumber: 2,
          pageCount: 3,
          searchQuery: 'mountain background',
        })
      }
      const reply = (json: {
        reply: string
        image?: unknown
        brand?: unknown
      }) => {
        history = [...history, latest, { role: 'assistant', text: json.reply }]
        return route.fulfill(wizardStream(json))
      }
      if (body.image) {
        expect(body.image).toEqual(image)
        expect(body.brand).toEqual(brand)
        // The model fails mid-stream: the client must discard the partial reply.
        if (++revisions === 1)
          return route.fulfill(
            wizardStream({ reply: 'Adjusting the ', error: wizardError }),
          )
        return reply({
          reply: 'Here is the revised mockup.',
          image: revisedImage,
        })
      }
      if (!starting) answered++
      if (answered >= questions.length)
        return reply({
          reply: 'Here is your billboard mockup. Tell me what to change.',
          image,
          brand,
        })
      return reply({ reply: questions[answered] })
    })
    // Prevent accidental calls to external maps, analytics, or communication providers.
    await page.route(
      (url) => /^https?:$/.test(url.protocol) && url.origin !== baseUrl,
      (route) => route.abort(),
    )

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.getByText('GPP3', { exact: true })).toBeVisible()
    await expect(page.getByText('Billboard Lead Form')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
    await expect(
      page.getByRole('link', { name: 'Billboard Source AI.', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('gpp3-sidebar.png'),
      animations: 'disabled',
    })
    await page
      .getByRole('button', { name: 'Close sidebar', exact: true })
      .click()
    if (placement === 'Lead tools') {
      await page
        .getByPlaceholder('Company Name', { exact: true })
        .fill('Example AI')
    }
    const tab = page
      .getByRole('tablist', { name: placement })
      .getByRole('tab', { name: 'Creative Studio' })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    const studio = page.getByRole('region', {
      name: 'Creative Studio',
      exact: true,
    })
    await expect(
      studio.getByRole('heading', { name: 'Creative Studio', exact: true }),
    ).toBeVisible()
    await expect(
      studio.getByRole('textbox', { name: 'Message', exact: true }),
    ).toBeEnabled()
    await expect(
      studio.getByText('One billboard. One clear idea.', { exact: false }),
    ).toHaveCount(0)
    await expect(
      studio.getByText('Active session only', { exact: false }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('gpp3-studio.png'),
      animations: 'disabled',
    })
    if (placement === 'Lead tools') {
      await expect(
        page.getByPlaceholder('Company Name', { exact: true }),
      ).toHaveValue('Example AI')
      await expect(
        studio.getByText(
          'I’ve brought over the usable facts from your current Lead Form.',
        ),
      ).toHaveCount(0)
      const draft = studio.getByRole('textbox', {
        name: 'Message',
        exact: true,
      })
      await draft.fill('Unsaved website draft')
      const tools = page.getByRole('tablist', { name: 'Lead tools' })
      await tools.getByRole('tab', { name: 'Pricing', exact: true }).click()
      await tab.click()
      await expect(draft).toHaveValue('Unsaved website draft')
      const views = page.getByRole('tablist', { name: 'Form views' })
      await views.getByRole('tab', { name: 'Creative Studio' }).click()
      await expect(draft).toHaveValue('Unsaved website draft')
      await draft.fill('Edited in full Studio')
      await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
      await tab.click()
      await expect(draft).toHaveValue('Edited in full Studio')
      await tools.getByRole('button', { name: 'Choose map' }).click()
      await expect(
        page.getByRole('menuitemradio', { name: 'Google Map', exact: true }),
      ).toBeChecked()
      await page.screenshot({
        path: testInfo.outputPath('studio-maps-menu.png'),
        animations: 'disabled',
      })
      await page
        .getByRole('menuitemradio', { name: 'BSI Map', exact: true })
        .click()
      await expect(
        tools.getByRole('tab', { name: 'Maps', exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(
        page.getByRole('heading', { name: 'BSI Map', exact: true }),
      ).toBeVisible()
      await tab.click()
      await expect(draft).toHaveValue('Edited in full Studio')
      await draft.fill('')
      await studio
        .getByRole('button', { name: 'Use current lead form', exact: true })
        .click()
      // The lead form's advertiser is offered up front, so the wizard skips Question 1.
      await expect(studio.getByRole('log')).toContainText(questions[1])
      await expect(studio.getByRole('log')).not.toContainText(questions[0])
    } else {
      await studio
        .getByRole('button', { name: 'Start Mockup', exact: true })
        .click()
      await expect(studio.getByRole('log')).toContainText(questions[0])
    }
    expect(chats).toHaveLength(1)

    const fixturePage = await context.newPage()
    await fixturePage.setViewportSize({ width: 600, height: 300 })
    await fixturePage.setContent(
      '<html><body style="margin:0;background:#c8e5f5"><div style="height:200px;display:grid;place-items:center;font: bold 48px sans-serif;color:#19392d">ALPINE</div><div style="height:100px;background:#45855a"></div></body></html>',
    )
    const logo = await fixturePage.screenshot({ type: 'png' })
    const photo = await fixturePage.screenshot({ type: 'jpeg' })
    await fixturePage.setContent(
      '<html><style>@page {margin:0} body {margin:0} section {height:300px;break-after:page;font:32px sans-serif}</style><body><section style="background:#ddd">Brand guidelines</section><section><div style="height:200px;background:#c8e5f5">Mountain background</div><div style="height:100px;background:#45855a"></div></section><section style="background:#fdb565">ALPINE LOGO</section></body></html>',
    )
    const pdf = await fixturePage.pdf({
      width: '600px',
      height: '300px',
      printBackground: true,
    })
    await fixturePage.close()
    let searches = 0
    await page.route('**/api/mockup/search-pdf', async (route) => {
      const body = route.request().postDataJSON()
      expect(
        body.pages.map((page: { pageNumber: number }) => page.pageNumber),
      ).toEqual([1, 2, 3])
      expect(
        new Set(body.pages.map((page: { dataUrl: string }) => page.dataUrl))
          .size,
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
    const choose = async (
      files: { name: string; mimeType: string; buffer: Buffer }[],
    ) => {
      await studio
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      const chooser = page.waitForEvent('filechooser')
      await page
        .getByRole('menuitem', { name: 'Add photos & files', exact: true })
        .click()
      await (await chooser).setFiles(files)
    }
    await choose([
      {
        name: 'bad.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<h1>bad</h1>'),
      },
    ])
    await expect(studio.getByRole('alert')).toContainText('PNG, JPEG, or PDF')
    await choose([
      {
        name: 'large.png',
        mimeType: 'image/png',
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      },
    ])
    await expect(studio.getByRole('alert')).toContainText(
      'no larger than 10 MB',
    )
    await choose([
      {
        name: 'broken.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-broken'),
      },
    ])
    await expect(studio.getByRole('alert')).toContainText(
      'Could not prepare broken.pdf',
    )
    await choose([{ name: 'logo.png', mimeType: 'image/png', buffer: logo }])
    await expect(
      studio.getByRole('img', { name: 'logo.png', exact: true }),
    ).toBeVisible()
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await choose([{ name: 'extra.png', mimeType: 'image/png', buffer: logo }])
    await expect(studio.getByRole('alert')).toContainText(
      'Use one reference file',
    )
    await studio.getByRole('button', { name: 'Remove logo.png' }).click()
    await expect(
      studio.getByRole('img', { name: 'logo.png', exact: true }),
    ).toHaveCount(0)
    const dropped = await page.evaluateHandle(
      ({ bytes }) => {
        const transfer = new DataTransfer()
        transfer.items.add(
          new File([Uint8Array.from(bytes)], 'photo.jpg', {
            type: 'image/jpeg',
          }),
        )
        return transfer
      },
      { bytes: [...photo] },
    )
    await studio
      .getByRole('textbox', { name: 'Message', exact: true })
      .dispatchEvent('drop', { dataTransfer: dropped })
    await dropped.dispose()
    await expect(
      studio.getByRole('img', { name: 'photo.jpg', exact: true }),
    ).toBeVisible()
    await studio.getByRole('button', { name: 'Remove photo.jpg' }).click()
    await choose([
      { name: 'scene.pdf', mimeType: 'application/pdf', buffer: pdf },
    ])
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 1 of 3)',
        exact: true,
      }),
    ).toBeVisible()
    const searchQuery = studio.getByRole('textbox', {
      name: 'Find a logo or background in this PDF',
    })
    const search = studio.getByRole('button', {
      name: 'Search PDF',
      exact: true,
    })
    await searchQuery.fill('mountain background')
    await search.click()
    await expect(studio.getByRole('alert')).toContainText(
      'Could not search the PDF',
    )
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 1 of 3)',
        exact: true,
      }),
    ).toBeVisible()
    await search.click()
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 2 of 3) · Selected for: mountain background',
        exact: true,
      }),
    ).toBeVisible()
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await searchQuery.fill('missing logo')
    await searchQuery.press('Enter')
    await expect(
      studio.getByText('No matching image found.', { exact: true }),
    ).toBeVisible()
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 2 of 3) · Selected for: mountain background',
        exact: true,
      }),
    ).toBeVisible()
    await searchQuery.fill('company logo')
    await search.click()
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 3 of 3) · Selected for: company logo',
        exact: true,
      }),
    ).toBeVisible()
    await searchQuery.fill('mountain background')
    await search.click()
    const pdfPreview = studio.getByRole('img', {
      name: 'scene.pdf (PDF page 2 of 3) · Selected for: mountain background',
      exact: true,
    })
    await expect(pdfPreview).toBeVisible()
    const colors = await pdfPreview.evaluate((element) => {
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
    expectPageTwoColors(colors)
    await studio.screenshot({
      path: testInfo.outputPath('studio-attachments.png'),
      animations: 'disabled',
    })

    const message = studio.getByRole('textbox', {
      name: 'Message',
      exact: true,
    })
    await answerQuestions(studio, answered, (index) =>
      index === 3
        ? studio.screenshot({
            path: testInfo.outputPath('studio-conversation.png'),
            animations: 'disabled',
          })
        : Promise.resolve(),
    )
    expect(answered).toBe(7)
    await expect(
      studio.getByRole('log').getByText(questions[5], { exact: false }),
    ).toHaveCount(1)
    await expect(
      studio.getByText('Here is your billboard mockup.', { exact: false }),
    ).toBeVisible()
    const selected = studio.getByRole('img', {
      name: 'Selected outdoor billboard concept for Example AI',
    })
    await expect(selected).toBeVisible()
    await expect(
      studio.getByText(
        'Concept only · Check text and brand details before sharing.',
      ),
    ).toBeVisible()
    await expect(
      studio.getByText('This selected image accompanies', { exact: false }),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('gpp3-result.png'),
      animations: 'disabled',
    })
    await expect(
      studio.getByRole('button', {
        name: 'Add to existing Nutshell lead',
        exact: true,
      }),
    ).toHaveCount(0)
    const generation = chats.at(-1)!
    expect(generation).toMatchObject({ image: null, brand: null })
    expect((generation.messages as Message[]).at(-1)).toEqual({
      role: 'user',
      text: 'Professional',
    })
    const references = generation.attachments as {
      sourceType: string
      dataUrl: string
    }[]
    expect(references.map((file) => file.sourceType)).toEqual([
      'application/pdf',
    ])
    expect(references[0]).toMatchObject({
      pageNumber: 2,
      pageCount: 3,
      searchQuery: 'mountain background',
    })
    references.forEach(expectCompactImage)
    const download = studio.getByRole('link', {
      name: 'Download selected mockup',
    })
    await expect(download).toHaveAttribute('href', image.dataUrl)
    await expect(selected).toHaveJSProperty('naturalWidth', 32)
    const downloadEvent = page.waitForEvent('download')
    await download.click()
    const downloaded = await downloadEvent
    expect(downloaded.suggestedFilename()).toBe(
      `billboard-concept-${image.id}.jpg`,
    )
    expect(await downloaded.failure()).toBeNull()

    const revision = message
    await revision.fill('Make the headline larger')
    await studio.getByRole('button', { name: 'Send message' }).click()
    await expect(studio.getByRole('alert')).toContainText(
      'Your conversation and selected image are unchanged',
    )
    await expect(studio.getByRole('log')).not.toContainText('Adjusting the')
    await expect(studio.getByRole('log')).not.toContainText(
      'Make the headline larger',
    )
    await expect(selected).toHaveAttribute('src', image.dataUrl)
    await expect(revision).toHaveValue('Make the headline larger')
    await expect(download).toHaveAttribute(
      'download',
      `billboard-concept-${image.id}.jpg`,
    )
    if (placement === 'Lead tools') {
      const views = page.getByRole('tablist', { name: 'Form views' })
      await views.getByRole('tab', { name: 'Creative Studio' }).click()
      await expect(revision).toHaveValue('Make the headline larger')
      await expect(studio.getByRole('alert')).toContainText(
        'Your conversation and selected image are unchanged',
      )
      await expect(selected).toHaveAttribute('src', image.dataUrl)
      await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
      await tab.click()
      await expect(revision).toHaveValue('Make the headline larger')
      await expect(studio.getByRole('alert')).toContainText(
        'Your conversation and selected image are unchanged',
      )
    }
    await studio.getByRole('button', { name: 'Send message' }).click()
    await expect(download).toHaveAttribute(
      'download',
      'billboard-concept-22222222-2222-4222-8222-222222222222.jpg',
    )
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
    await expect(selected).toHaveJSProperty('naturalWidth', 24)
    expect(chats.at(-1)).toMatchObject({
      image,
      brand,
      attachments: references,
    })
    expect((chats.at(-1)!.messages as Message[]).at(-1)).toEqual({
      role: 'user',
      text: 'Make the headline larger',
    })
    await expect(studio.getByRole('log')).toContainText(
      'Here is the revised mockup.',
    )

    if (placement === 'Lead tools') {
      await expect(
        page.getByText(
          'Nutshell will include the selected mockup for Example AI.',
        ),
      ).toBeVisible()
      let submitted: Record<string, unknown> | undefined
      await page.route('**/api/nutshell/create-lead', async (route) => {
        submitted = route.request().postDataJSON()
        return route.fulfill({
          status: 400,
          json: { error: 'Complete the required fields' },
        })
      })
      await page.getByRole('button', { name: 'Nutshell', exact: true }).click()
      await expect
        .poll(() => submitted)
        .toMatchObject({ entityName: 'Example AI', mockupImage: revisedImage })
      await page.screenshot({
        path: testInfo.outputPath('studio-desktop.png'),
        animations: 'disabled',
      })
      await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByRole('button', { name: 'Nutshell', exact: true })
        .scrollIntoViewIfNeeded()
      await expect(tab).toBeInViewport()
      await expect(
        page.getByRole('button', { name: 'Nutshell', exact: true }),
      ).toBeInViewport()
      await pdfPreview.evaluate((image) =>
        image.scrollIntoView({ block: 'center' }),
      )
      await studio
        .getByRole('button', { name: 'Search PDF', exact: true })
        .click({ trial: true })
      await page.screenshot({
        path: testInfo.outputPath('studio-mobile-reference.png'),
        animations: 'disabled',
      })
      await revision.fill('Keep the background and simplify the headline')
      const sendRevision = studio.getByRole('button', {
        name: 'Send message',
      })
      await sendRevision.evaluate((button) =>
        button.scrollIntoView({ block: 'center' }),
      )
      await expect(sendRevision).toBeInViewport({ ratio: 1 })
      await sendRevision.click({ trial: true })
      await page.screenshot({
        path: testInfo.outputPath('studio-mobile.png'),
        animations: 'disabled',
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.setViewportSize({ width: 1440, height: 1000 })
    }

    await page.reload()
    await tab.click()
    await expect(
      studio.getByRole('img', {
        name: 'scene.pdf (PDF page 2 of 3) · Selected for: mountain background',
      }),
    ).toBeVisible()
    await expect(
      studio.getByText(
        'The selected page is preserved. Remove and reattach the PDF to search again after a refresh.',
      ),
    ).toBeVisible()
    await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
    await expect(download).toHaveAttribute(
      'download',
      'billboard-concept-22222222-2222-4222-8222-222222222222.jpg',
    )
    await studio
      .getByRole('button', { name: 'Start Mockup', exact: true })
      .click()
    await expect(selected).toHaveCount(0)
    await expect(studio.getByRole('log')).toContainText(questions[0])
    await expect(studio.getByRole('log')).not.toContainText(
      'Here is the revised mockup.',
    )
    await expect(studio.getByRole('button', { name: /^Remove / })).toHaveCount(
      0,
    )
    expect(revisions).toBe(2)
    expect(chats).toHaveLength(placement === 'Lead tools' ? 10 : 11)
    expect(unexpected).toEqual([])
  })
}
