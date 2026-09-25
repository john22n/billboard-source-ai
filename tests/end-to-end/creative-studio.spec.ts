import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { jwtSecret, userId } from './environment'

const answers = [
  {
    field: 'advertiser',
    value: 'Example AI',
    question: 'What is the advertiser’s name?',
  },
  {
    field: 'website',
    value: 'https://example.com',
    question: 'What is their website? You can say skip.',
  },
  {
    field: 'goal',
    value: 'Awareness',
    question:
      'What should this billboard accomplish: awareness, calls, visits, an event, political, hiring, an opening, or an offer?',
  },
  {
    field: 'market',
    value: 'Denver',
    question: 'Which city, market, or audience should it reach?',
  },
  {
    field: 'focus',
    value: 'AI Integration',
    question: 'What product, service, event, or message should it focus on?',
  },
  {
    field: 'required',
    value: 'website and website content',
    question:
      'What exact text must appear? Include any phone, website, slogan, date, address, candidate name, or legal disclaimer—or say skip.',
  },
  {
    field: 'tone',
    value: 'Professional',
    question:
      'What tone feels right: professional, bold, premium, fun, urgent, community, political, minimal, or family-friendly? Unsure is fine.',
  },
]
const summary = {
  headline: 'AI for your business',
  supporting: 'AI Integration',
  contact: 'example.com',
  direction:
    'Navy #14283f background, orange #ed7b32 accents, cream #f9e7c4 text.',
  caution:
    'Keep the headline short and the website easy to read at driving speed.',
}
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

for (const placement of ['Form views', 'Lead tools']) {
  test(`Creative Studio in ${placement} completes intake, approves the summary, retries a revision, and resets`, async ({
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
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])

    let intake: Record<string, string | null> = {
      advertiser: null,
      website: null,
      goal: null,
      market: null,
      focus: null,
      required: null,
      tone: null,
      boardType: 'Static',
    }
    let answerCount = 0
    const generations: Record<string, unknown>[] = []
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
    await page.route('**/api/mockup/intake', async (route) => {
      const body = route.request().postDataJSON()
      const answer = answers[answerCount++]
      expect(body).toMatchObject({
        intake,
        message: answer.value,
        review: false,
      })
      expect(
        body.attachments.map((file: { name: string }) => file.name),
      ).toEqual(['logo.png', 'scene.pdf', 'photo.jpg'])
      expect(body.attachmentInstructions).toContain(answer.value)
      intake = { ...intake, [answer.field]: answer.value }
      return route.fulfill({
        json: {
          intake,
          ...(answerCount === answers.length
            ? {
                summary,
                brand: {
                  notes: 'Website palette reviewed.',
                  fallback: '',
                  logo: null,
                  receipt: null,
                },
              }
            : {}),
        },
      })
    })
    await page.route('**/api/mockup/generate', async (route) => {
      generations.push(route.request().postDataJSON())
      if (generations.length === 2)
        return route.fulfill({
          status: 502,
          json: {
            error:
              'The image could not be generated. Your selected image is unchanged.',
          },
        })
      return route.fulfill({
        json: {
          image: generations.length === 1 ? image : revisedImage,
        },
      })
    })
    // Prevent accidental calls to external maps, analytics, or communication providers.
    await page.route(/^https?:\/\/(?!localhost:3000(?:\/|$))/, (route) =>
      route.abort(),
    )

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.setViewportSize({ width: 1440, height: 1000 })
    if (placement === 'Lead tools') {
      await page
        .getByPlaceholder('Company Name', { exact: true })
        .fill('Example AI')
      intake.advertiser = 'Example AI'
      answerCount = 1
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
      studio.getByRole('textbox', { name: 'Your answer', exact: true }),
    ).toBeEnabled()
    if (placement === 'Lead tools') {
      await expect(
        page.getByPlaceholder('Company Name', { exact: true }),
      ).toHaveValue('Example AI')
      await expect(
        studio.getByText(
          'I’ve brought over the usable facts from your current Lead Form.',
        ),
      ).toBeVisible()
      const draft = studio.getByRole('textbox', {
        name: 'Your answer',
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
    } else {
      await studio
        .getByRole('button', { name: 'Start Mockup', exact: true })
        .click()
    }

    const fixturePage = await context.newPage()
    await fixturePage.setViewportSize({ width: 600, height: 300 })
    await fixturePage.setContent(
      '<html><body style="margin:0;background:#c8e5f5"><div style="height:200px;display:grid;place-items:center;font: bold 48px sans-serif;color:#19392d">ALPINE</div><div style="height:100px;background:#45855a"></div></body></html>',
    )
    const logo = await fixturePage.screenshot({ type: 'png' })
    const pdf = await fixturePage.pdf({
      width: '600px',
      height: '300px',
      printBackground: true,
    })
    const photo = await fixturePage.screenshot({ type: 'jpeg' })
    await fixturePage.close()
    const choose = async (
      files: { name: string; mimeType: string; buffer: Buffer }[],
    ) => {
      const chooser = page.waitForEvent('filechooser')
      await studio.getByRole('button', { name: 'Attach files' }).click()
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
    await choose([
      { name: 'logo.png', mimeType: 'image/png', buffer: logo },
      { name: 'scene.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo },
    ])
    await expect(
      studio.getByRole('img', { name: 'scene.pdf (PDF page 1 only)' }),
    ).toBeVisible()
    await expect(studio.getByRole('alert')).toHaveCount(0)
    const colors = await studio
      .getByRole('img', { name: 'scene.pdf (PDF page 1 only)' })
      .evaluate((element) => {
        const image = element as HTMLImageElement
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return [
          [...context.getImageData(5, 5, 1, 1).data].slice(0, 3),
          [...context.getImageData(5, canvas.height - 5, 1, 1).data].slice(
            0,
            3,
          ),
        ]
      })
    // Independent colors from the PDF fixture: sky #c8e5f5 and ground #45855a.
    for (const [index, expected] of [
      [200, 229, 245],
      [69, 133, 90],
    ].entries())
      expected.forEach((value, channel) =>
        expect(Math.abs(colors[index][channel] - value)).toBeLessThan(4),
      )
    await choose([{ name: 'extra.png', mimeType: 'image/png', buffer: logo }])
    await expect(studio.getByRole('alert')).toContainText(
      'up to 3 reference files',
    )
    await studio.getByRole('button', { name: 'Remove photo.jpg' }).click()
    await expect(
      studio.getByRole('img', { name: 'photo.jpg', exact: true }),
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
      .getByRole('textbox', { name: 'Your answer', exact: true })
      .dispatchEvent('drop', { dataTransfer: dropped })
    await dropped.dispose()
    await expect(
      studio.getByRole('img', { name: 'photo.jpg', exact: true }),
    ).toBeVisible()
    await studio.screenshot({
      path: testInfo.outputPath('studio-attachments.png'),
      animations: 'disabled',
    })

    for (const answer of answers.slice(answerCount)) {
      await expect(studio.getByText(answer.question)).toBeVisible()
      await studio
        .getByRole('textbox', { name: 'Your answer', exact: true })
        .fill(answer.value)
      await studio.getByRole('button', { name: 'Send answer' }).click()
      await expect(
        studio.getByRole('textbox', { name: 'Your answer', exact: true }),
      ).toHaveValue('')
    }
    expect(answerCount).toBe(7)
    // The required-copy question appears once, not again after the website-content answer.
    await expect(
      studio.getByRole('log').getByText(answers[5].question),
    ).toHaveCount(1)
    await expect(
      studio.getByText('Billboard summary', { exact: true }),
    ).toHaveCount(0)
    await expect(
      studio.getByText(summary.caution, { exact: true }),
    ).toBeVisible()
    await expect(
      studio.getByText(summary.direction, { exact: true }),
    ).toHaveCount(0)
    await expect(
      studio.getByRole('textbox', { name: 'Headline', exact: true }),
    ).toHaveCount(0)
    expect(generations).toHaveLength(0)

    await page.screenshot({
      path: testInfo.outputPath('orange-summary.png'),
      animations: 'disabled',
    })
    await studio
      .getByRole('button', { name: 'Generate mockup', exact: true })
      .click()
    const selected = studio.getByRole('img', {
      name: 'Selected outdoor billboard concept for Example AI',
    })
    await expect(selected).toBeVisible()
    await expect(
      studio.getByRole('button', {
        name: 'Add to existing Nutshell lead',
        exact: true,
      }),
    ).toHaveCount(0)
    expect(generations[0]).toMatchObject({
      approved: true,
      previous: null,
      revision: '',
      intake: {
        website: 'https://example.com',
        required: 'website and website content',
      },
      summary,
    })
    const references = generations[0].attachments as {
      sourceType: string
      dataUrl: string
    }[]
    expect(references.map((file) => file.sourceType)).toEqual([
      'image/png',
      'application/pdf',
      'image/jpeg',
    ])
    for (const file of references) {
      expect(file.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
      expect(file.dataUrl.length).toBeLessThanOrEqual(400_000)
    }
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

    const revision = studio.getByRole('textbox', {
      name: 'Revision instructions',
    })
    await revision.fill('Make the headline larger')
    await studio.getByRole('button', { name: 'Generate revision' }).click()
    await expect(studio.getByRole('alert')).toContainText(
      'Your selected image is unchanged',
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
        'Your selected image is unchanged',
      )
      await expect(selected).toHaveAttribute('src', image.dataUrl)
      await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
      await tab.click()
      await expect(revision).toHaveValue('Make the headline larger')
      await expect(studio.getByRole('alert')).toContainText(
        'Your selected image is unchanged',
      )
    }
    await studio.getByRole('button', { name: 'Generate revision' }).click()
    await expect(download).toHaveAttribute(
      'download',
      'billboard-concept-22222222-2222-4222-8222-222222222222.jpg',
    )
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await expect(selected).toHaveAttribute('src', revisedImage.dataUrl)
    await expect(selected).toHaveJSProperty('naturalWidth', 24)
    expect(generations[2]).toMatchObject({
      approved: false,
      previous: image,
      revision: 'Make the headline larger',
      attachments: references,
    })

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
      await revision.fill('Keep the background and simplify the headline')
      const sendRevision = studio.getByRole('button', {
        name: 'Generate revision',
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
      studio.getByRole('img', { name: 'scene.pdf (PDF page 1 only)' }),
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
    await expect(
      studio.getByText(answers[0].question, { exact: true }),
    ).toBeVisible()
    await expect(studio.getByRole('log')).toBeEmpty()
    await expect(studio.getByRole('button', { name: /^Remove / })).toHaveCount(
      0,
    )
    expect(generations).toHaveLength(3)
    expect(unexpected).toEqual([])
  })
}
