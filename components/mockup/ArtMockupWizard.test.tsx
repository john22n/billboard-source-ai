// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArtMockupWizard } from './ArtMockupWizard'
import { useMockupStore } from '@/stores/mockupStore'
import { freshIntake } from '@/lib/mockup/intake'

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useMockupStore.getState().clear()
  useMockupStore.getState().initialize('rep:123')
  useMockupStore.getState().start()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function send(text: string) {
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

it('sends intake, blocks duplicates while pending, and advances the conversation', async () => {
  let finish!: (response: Response) => void
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Alpine Dental')
  expect(container.querySelector('textarea')?.disabled).toBe(true)
  await send('Duplicate')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    intake: freshIntake(),
    message: 'Alpine Dental',
    review: false,
  })
  await act(async () =>
    finish(
      Response.json({
        intake: { ...freshIntake(), advertiser: 'Alpine Dental' },
      }),
    ),
  )
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    'What is their website?',
  )
  expect(container.querySelector('textarea')?.value).toBe('')
  expect(useMockupStore.getState().busy).toBe(false)
})

it('ignores an old response after starting a different mockup', async () => {
  let finish!: (response: Response) => void
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Old advertiser')
  await act(async () =>
    useMockupStore.getState().start({ entityName: 'New advertiser' }),
  )
  await act(async () =>
    finish(
      Response.json({
        intake: { ...freshIntake(), advertiser: 'Old advertiser' },
      }),
    ),
  )
  expect(useMockupStore.getState().state.intake.advertiser).toBe(
    'New advertiser',
  )
  expect(useMockupStore.getState().state.messages).toEqual([])
  expect(container.querySelector('textarea')?.value).toBe('')
})

it('revises the selected image and retains both it and the draft on failure', async () => {
  const image = {
    id: '12345678-1234-4123-8123-123456789abc',
    advertiser: 'Alpine Dental',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    receipt: 'signed',
  }
  useMockupStore.getState().update({ image })
  fetchMock.mockResolvedValueOnce(
    Response.json({ error: 'Try again later.' }, { status: 502 }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Remove the phone number')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/mockup/generate')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    previous: image,
    approved: false,
    revision: 'Remove the phone number',
  })
  expect(useMockupStore.getState().state.image).toEqual(image)
  expect(container.querySelector('textarea')?.value).toBe(
    'Remove the phone number',
  )
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Try again later.',
  )
  expect(useMockupStore.getState().busy).toBe(false)
})
