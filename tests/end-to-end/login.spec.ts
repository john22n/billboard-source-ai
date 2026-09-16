import { expect, test } from 'playwright/test'

test('login validates email and lets users return from the password step', async ({
  page,
}) => {
  await page.goto('/login')

  await expect(
    page.getByRole('heading', { name: 'Login to your account' }),
  ).toBeVisible()

  const email = page.getByRole('textbox', { name: 'Email', exact: true })
  const continueButton = page.getByRole('button', { name: 'Continue' })
  const password = page.getByLabel('Password', { exact: true })

  await expect(email).toBeVisible()
  await expect(password).toHaveCount(0)
  await continueButton.click()
  expect(
    await email.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true)
  await expect(password).toHaveCount(0)

  await email.fill('not-an-email')
  await continueButton.click()
  expect(
    await email.evaluate(
      (input: HTMLInputElement) => input.validity.typeMismatch,
    ),
  ).toBe(true)
  await expect(password).toHaveCount(0)

  await email.fill('login-test@example.com')
  await continueButton.click()

  await expect(
    page.getByText('login-test@example.com', { exact: true }),
  ).toBeVisible()
  await expect(password).toBeVisible()
  await expect(password).toHaveAttribute('type', 'password')
  await expect(
    page.getByRole('button', { name: 'Login', exact: true }),
  ).toBeEnabled()
  await password.fill('temporary-test-password')

  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await expect(email).toHaveValue('login-test@example.com')
  await expect(password).toHaveCount(0)

  await continueButton.click()
  await expect(password).toHaveValue('')
  await expect(page).toHaveURL(/\/login$/)
})
