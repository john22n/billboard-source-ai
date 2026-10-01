// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ArtWizardTab from './art-wizard-tab'

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function edit(value: string) {
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

it('loads the saved prompt, rejects blank edits, and reports a successful save', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ prompt: 'Original prompt' }))
  await act(async () => root.render(<ArtWizardTab />))
  const button = container.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement
  expect(container.querySelector('textarea')?.value).toBe('Original prompt')
  expect(button.disabled).toBe(true)
  await edit(' \n ')
  expect(button.disabled).toBe(true)
  await edit('Use watercolor.')
  expect(button.disabled).toBe(false)
  fetchMock.mockResolvedValueOnce(Response.json({ prompt: 'Use watercolor.' }))
  await submit()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/art-wizard', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Use watercolor.' }),
  })
  expect(container.textContent).toContain('Prompt saved')
  expect(button.disabled).toBe(true)
})

it('keeps unsaved edits after a failed save and allows retrying', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ prompt: 'Original prompt' }))
  await act(async () => root.render(<ArtWizardTab />))
  const input = await edit('My unsaved prompt')
  fetchMock.mockResolvedValueOnce(
    Response.json({ error: 'Could not save.' }, { status: 500 }),
  )
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not save.',
  )
  expect(input.value).toBe('My unsaved prompt')
  expect(
    (container.querySelector('button[type="submit"]') as HTMLButtonElement)
      .disabled,
  ).toBe(false)
  fetchMock.mockResolvedValueOnce(
    Response.json({ prompt: 'My unsaved prompt' }),
  )
  await submit()
  expect(container.textContent).toContain('Prompt saved')
})

it('shows a load error instead of an editable empty prompt and supports retry', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Offline'))
  await act(async () => root.render(<ArtWizardTab />))
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(container.querySelector('textarea')).toBeNull()
  fetchMock.mockResolvedValueOnce(Response.json({ prompt: 'Loaded on retry' }))
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('textarea')?.value).toBe('Loaded on retry')
})

it('disables the editor and duplicate submissions while saving', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ prompt: 'Original prompt' }))
  await act(async () => root.render(<ArtWizardTab />))
  const input = await edit('Updated instructions')
  let finish!: (response: Response) => void
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await submit()
  const button = container.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(input.disabled).toBe(true)
  expect(button.textContent).toBe('Saving…')
  await submit()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () =>
    finish(Response.json({ prompt: 'Updated instructions' })),
  )
  expect(input.disabled).toBe(false)
  expect(container.textContent).toContain('Prompt saved')
})
