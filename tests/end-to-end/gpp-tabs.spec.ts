import { SignJWT } from 'jose'
import { expect, test } from 'playwright/test'
import { baseUrl, jwtSecret, userId } from './environment'

test.beforeEach(async ({ page, context }) => {
  // The first navigation compiles the dashboard on a cold dev server.
  test.setTimeout(120_000)
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
    async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== 'https://geopoepoe.com') return route.abort()
      const title = url.pathname.endsWith('/proposals')
        ? 'My Proposals & Contracts'
        : url.searchParams.get('sidebar') === '0'
          ? 'Lead Inventory'
          : 'Inventory Explorer'
      await route.fulfill({
        contentType: 'text/html',
        body: `<h1>${title}</h1><label>Draft<input></label>
            <button onclick="window.top.postMessage({type:'gpp:create-typical',version:1,generatorUrl:'https://geopoepoe.com/gpp/v3/proposal-generator',boardIds:[12,1],count:2}, '*')">Create Typical</button>
            <output aria-label="Acknowledgement"></output>
            <script>window.addEventListener('message', event => {
              if (event.data?.type === 'gpp:create-typical-ack' && event.data.version === 1)
                document.querySelector('output').textContent = 'Received';
            });</script>`,
      })
    },
  )
  await page.addLocatorHandler(
    page.getByRole('button', { name: 'Dismiss announcement' }),
    (button) => button.click(),
  )
  await page.goto('/dashboard')
})

for (const firstTab of ['Proposals', 'Inventory Explorer']) {
  test(`GPP loads only visited views and preserves drafts (${firstTab} first)`, async ({
    page,
  }) => {
    const views = page.getByRole('tablist', { name: 'Form views' })
    await expect(views).toBeVisible()
    await expect(page.getByTitle('Proposals', { exact: true })).toHaveCount(0)
    await expect(
      page.getByTitle('Inventory Explorer', { exact: true }),
    ).toHaveCount(0)

    await views.getByRole('tab', { name: firstTab }).click()
    const firstFrame = page.getByTitle(firstTab, { exact: true }).contentFrame()
    await expect(firstFrame.getByRole('heading')).toHaveText(
      firstTab === 'Proposals'
        ? 'My Proposals & Contracts'
        : 'Inventory Explorer',
    )
    const otherTab =
      firstTab === 'Proposals' ? 'Inventory Explorer' : 'Proposals'
    await expect(page.getByTitle(otherTab, { exact: true })).toHaveCount(0)
    await firstFrame.getByLabel('Draft').fill('Keep this unsaved work')
    await views.getByRole('tab', { name: otherTab }).click()
    await expect(
      page
        .getByTitle(otherTab, { exact: true })
        .contentFrame()
        .getByRole('heading'),
    ).toHaveText(
      otherTab === 'Proposals'
        ? 'My Proposals & Contracts'
        : 'Inventory Explorer',
    )
    await views.getByRole('tab', { name: firstTab }).click()
    await expect(firstFrame.getByLabel('Draft')).toHaveValue(
      'Keep this unsaved work',
    )

    await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
    await expect(
      page.getByTitle('Inventory Explorer', { exact: true }),
    ).toHaveCount(1)
    await page
      .getByRole('tablist', { name: 'Lead tools' })
      .getByRole('tab', { name: 'Inventory Explorer' })
      .click()
    const leadFrame = page
      .getByRole('tabpanel', {
        name: 'Lead Form & Pricing',
        includeHidden: true,
      })
      .getByTitle('Inventory Explorer', { exact: true })
      .contentFrame()
    await expect(leadFrame.getByRole('heading')).toHaveText('Lead Inventory')
    await leadFrame.getByLabel('Draft').fill('Keep lead filters')
    await views.getByRole('tab', { name: 'Proposals' }).click()
    await views.getByRole('tab', { name: 'Lead Form & Pricing' }).click()
    await page
      .getByRole('tablist', { name: 'Lead tools' })
      .getByRole('tab', { name: 'Inventory Explorer' })
      .click()
    await expect(leadFrame.getByLabel('Draft')).toHaveValue('Keep lead filters')

    // Both embedded explorers must open the generator in the outer Proposals tab.
    for (const inventory of [
      leadFrame,
      page
        .getByRole('tabpanel', {
          name: 'Inventory Explorer',
          exact: true,
        })
        .getByTitle('Inventory Explorer', { exact: true })
        .contentFrame(),
    ]) {
      if (inventory !== leadFrame)
        await views.getByRole('tab', { name: 'Inventory Explorer' }).click()
      await inventory.getByRole('button', { name: 'Create Typical' }).click()
      await expect(
        views.getByRole('tab', { name: 'Proposals' }),
      ).toHaveAttribute('aria-selected', 'true')
      const proposals = page.getByTitle('Proposals', { exact: true })
      await expect(proposals).toHaveAttribute(
        'src',
        'https://geopoepoe.com/gpp/v3/proposal-generator',
      )
      await expect(proposals.contentFrame().getByLabel('Draft')).toHaveValue('')
      await proposals.contentFrame().getByLabel('Draft').fill('Previous boards')
      await views
        .getByRole('tab', {
          name:
            inventory === leadFrame
              ? 'Lead Form & Pricing'
              : 'Inventory Explorer',
        })
        .click()
      await expect(inventory.getByLabel('Acknowledgement')).toHaveText(
        'Received',
      )
    }
  })
}

test('Create Typical opens the Proposals frame before its first visit', async ({
  page,
}) => {
  const views = page.getByRole('tablist', { name: 'Form views' })
  await views.getByRole('tab', { name: 'Inventory Explorer' }).click()
  await expect(page.getByTitle('Proposals', { exact: true })).toHaveCount(0)
  await page
    .getByTitle('Inventory Explorer', { exact: true })
    .contentFrame()
    .getByRole('button', { name: 'Create Typical' })
    .click()
  await expect(views.getByRole('tab', { name: 'Proposals' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTitle('Proposals', { exact: true })).toHaveAttribute(
    'src',
    'https://geopoepoe.com/gpp/v3/proposal-generator',
  )
})
