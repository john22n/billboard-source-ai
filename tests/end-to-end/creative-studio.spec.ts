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
      expect(body).toEqual({ intake, message: answer.value, review: false })
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
    expect(generations).toHaveLength(3)
    expect(unexpected).toEqual([])
  })
}
