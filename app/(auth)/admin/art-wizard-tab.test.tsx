// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ArtWizardTab from './art-wizard-tab'
import { defaultImageSettings } from '@/lib/mockup/image-settings'

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

const button = (text: string) => {
  const found = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent === text,
  )
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

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

it('keeps one system prompt editor with ratio-only image settings and read-only protected frames', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      prompt: 'Original prompt',
      isDefault: true,
      instructions: [
        {
          title: 'Tool instructions',
          context: 'Appended to the system prompt.',
          text: 'Always call generate_billboard.',
        },
      ],
    }),
  )
  await act(async () => root.render(<ArtWizardTab />))
  expect(container.textContent).toContain('Tool instructions')
  expect(container.textContent).toContain('Always call generate_billboard.')
  expect(container.querySelectorAll('textarea')).toHaveLength(1)
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(4)
  expect(container.querySelector('textarea')?.value).toBe('Original prompt')
  expect(container.textContent).toContain('Read-only')
  expect(container.textContent).toContain('Using the original prompt.')
  expect(button('Reset prompt and ratios').disabled).toBe(true)
})

it('loads the saved prompt, rejects blank edits, and reports a successful save', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ prompt: 'Original prompt', isDefault: false }),
  )
  await act(async () => root.render(<ArtWizardTab />))
  const save = button('Save settings')
  expect(container.querySelector('textarea')?.value).toBe('Original prompt')
  expect(container.textContent).toContain('Using saved settings.')
  expect(save.disabled).toBe(true)
  await edit(' \n ')
  expect(save.disabled).toBe(true)
  await edit('Ask three questions.')
  expect(save.disabled).toBe(false)
  fetchMock.mockResolvedValueOnce(
    Response.json({
      prompt: 'Ask three questions.',
      isDefault: false,
      imageSettings: defaultImageSettings,
    }),
  )
  await submit()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/art-wizard', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Ask three questions.',
      imageSettings: defaultImageSettings,
    }),
  })
  expect(container.textContent).toContain('Settings saved')
  expect(save.disabled).toBe(true)
})

it('resets to the original prompt with one click and replaces the editor text', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ prompt: 'Customized prompt', isDefault: false }),
  )
  await act(async () => root.render(<ArtWizardTab />))
  const input = await edit('Half-finished edit')
  fetchMock.mockResolvedValueOnce(
    Response.json({
      prompt: 'You are the Billboard Source Mockup Wizard.',
      isDefault: true,
      imageSettings: defaultImageSettings,
    }),
  )
  await act(async () => button('Reset prompt and ratios').click())
  expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/art-wizard', {
    method: 'DELETE',
  })
  expect(input.value).toBe('You are the Billboard Source Mockup Wizard.')
  expect(container.textContent).toContain(
    'Original system prompt and face ratios restored',
  )
  expect(button('Reset prompt and ratios').disabled).toBe(true)
  expect(button('Save settings').disabled).toBe(true)
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
  expect(button('Save settings').disabled).toBe(false)
  fetchMock.mockResolvedValueOnce(
    Response.json({
      prompt: 'My unsaved prompt',
      imageSettings: defaultImageSettings,
    }),
  )
  await submit()
  expect(container.textContent).toContain('Settings saved')
})

it('shows the API storage error instead of blaming admin access', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json(
      { error: 'Could not load Creative Studio instructions. Please retry.' },
      { status: 500 },
    ),
  )
  await act(async () => root.render(<ArtWizardTab />))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Could not load Creative Studio instructions. Please retry.',
  )
  expect(container.textContent).not.toContain('admin access')
  expect(container.querySelector('textarea')).toBeNull()
})

it.each([
  [401, 'Your session has expired. Sign in and retry.'],
  [403, 'Admin access is required to edit the prompt.'],
])(
  'explains an authorization response with status %i',
  async (status, error) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'Authorization failed' }, { status }),
    )
    await act(async () => root.render(<ArtWizardTab />))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(error)
    expect(container.querySelector('textarea')).toBeNull()
  },
)

it('shows a network error instead of an editable empty prompt and supports retry', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Offline'))
  await act(async () => root.render(<ArtWizardTab />))
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Offline')
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
  const save = button('Saving…')
  expect(save.disabled).toBe(true)
  expect(input.disabled).toBe(true)
  expect(button('Reset prompt and ratios').disabled).toBe(true)
  await submit()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await act(async () =>
    finish(
      Response.json({
        prompt: 'Updated instructions',
        imageSettings: defaultImageSettings,
      }),
    ),
  )
  expect(input.disabled).toBe(false)
  expect(container.textContent).toContain('Settings saved')
})
