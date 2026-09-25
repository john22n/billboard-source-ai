// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArtMockupWizard } from './ArtMockupWizard'
import { AttachMockup } from './AttachMockup'
import { useMockupSession } from '@/hooks/useMockupSession'
import { useMockupStore } from '@/stores/mockupStore'

let root: Root
let container: HTMLDivElement
const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  advertiser: 'Alpine',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  receipt: 'signed',
}
const brand = { website: 'alpine.example', logo: null, receipt: null }

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  useMockupStore.getState().clear()
  useMockupStore.getState().initialize('rep:1')
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
  const found = Array.from(document.querySelectorAll('button')).find(
    (el) => el.textContent === text,
  )
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const body = (call = 0) =>
  JSON.parse(vi.mocked(fetch).mock.calls[call][1]!.body as string)

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

it('sends Start on the rep’s behalf once, even with two Studio views mounted', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ reply: 'What is the advertiser’s name?' }),
  )
  await act(async () =>
    root.render(
      <>
        <ArtMockupWizard key="inline" />
        <ArtMockupWizard key="outer" />
      </>,
    ),
  )
  await act(async () =>
    useMockupStore.getState().start({ entityName: 'Alpine' }),
  )
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/mockup/chat')
  expect(body()).toEqual({
    messages: [
      {
        role: 'user',
        text: 'Start\n\nHere is what I already know from the lead form:\nAdvertiser: Alpine',
      },
    ],
    attachments: [],
    image: null,
    brand: null,
  })
  expect(useMockupStore.getState().state.messages.at(-1)).toEqual({
    role: 'assistant',
    text: 'What is the advertiser’s name?',
  })
  expect(useMockupStore.getState().opening).toBeNull()
})

it('sends the conversation, blocks duplicates while pending, and appends the reply', async () => {
  useMockupStore.getState().update({
    messages: [{ role: 'assistant', text: 'What is their website?' }],
  })
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('alpine.example')
  expect(container.querySelector('textarea')?.readOnly).toBe(true)
  expect(container.querySelector('textarea')?.disabled).toBe(false)
  await send('Duplicate')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(body()).toEqual({
    messages: [
      { role: 'assistant', text: 'What is their website?' },
      { role: 'user', text: 'alpine.example' },
    ],
    attachments: [],
    image: null,
    brand: null,
  })
  await act(async () =>
    finish(Response.json({ reply: 'What is the goal?', brand, image: null })),
  )
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    'What is the goal?',
  )
  expect(useMockupStore.getState().state.brand).toEqual(brand)
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(container.querySelector('textarea')?.value).toBe('')
  expect(container.querySelector('textarea')?.readOnly).toBe(false)
  expect(useMockupStore.getState().busy).toBe(false)
})

it('treats Start as a local reset instead of a wizard message', async () => {
  useMockupStore.getState().update({ image, brand })
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ reply: 'Question 1' }))
  await act(async () => root.render(<ArtMockupWizard />))
  await send('start mockup')
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(useMockupStore.getState().state.brand).toBeNull()
  expect(body()).toMatchObject({
    messages: [{ role: 'user', text: 'Start' }],
    image: null,
    brand: null,
  })
})

it('ignores an old response after starting a different mockup', async () => {
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Old advertiser')
  await act(async () => useMockupStore.getState().start())
  await act(async () => finish(Response.json({ reply: 'Old reply', image })))
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(
    useMockupStore
      .getState()
      .state.messages.some((m) => m.text === 'Old reply'),
  ).toBe(false)
})

it('keeps the selected image, brand and draft when a revision fails', async () => {
  useMockupStore.getState().update({ image, brand })
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'Try again later.' }, { status: 502 }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Remove the phone number')
  expect(body()).toMatchObject({
    messages: [{ role: 'user', text: 'Remove the phone number' }],
    image,
    brand,
  })
  expect(useMockupStore.getState().state.image).toEqual(image)
  expect(useMockupStore.getState().state.messages).toEqual([])
  expect(container.querySelector('textarea')?.value).toBe(
    'Remove the phone number',
  )
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Try again later.',
  )
})

it('replaces the selected image only when the wizard returns a new one', async () => {
  useMockupStore.getState().update({ image })
  const revised = { ...image, id: '22222222-2222-4222-8222-222222222222' }
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ reply: 'Kept the layout; nothing else changed.' }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Thanks')
  expect(useMockupStore.getState().state.image).toEqual(image)
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ reply: 'Here is the revision.', image: revised }),
  )
  await send('Bigger text')
  expect(useMockupStore.getState().state.image).toEqual(revised)
  expect(container.querySelector('a[download]')?.getAttribute('download')).toBe(
    `billboard-concept-${revised.id}.jpg`,
  )
})

it('shares pending drafts and failures across Studio views and clears them on restart', async () => {
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard key="outer" />))
  await send('alpine.example')
  await act(async () => root.render(<ArtMockupWizard key="inline" />))
  expect(container.querySelector('textarea')?.value).toBe('alpine.example')
  expect(container.querySelector('textarea')?.readOnly).toBe(true)
  await act(async () =>
    finish(Response.json({ error: 'Try again later.' }, { status: 502 })),
  )
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Try again later.',
  )
  await act(async () =>
    root.render(
      <>
        <ArtMockupWizard key="inline" />
        <ArtMockupWizard key="outer" />
      </>,
    ),
  )
  expect(
    Array.from(container.querySelectorAll('textarea'), (el) => el.value),
  ).toEqual(['alpine.example', 'alpine.example'])
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2)
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ reply: 'Question 1' }))
  await act(async () => button('Start Mockup').click())
  expect(
    Array.from(container.querySelectorAll('textarea'), (el) => el.value),
  ).toEqual(['', ''])
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('shows download but no existing-lead action, retaining recovery for a failed lead attachment', async () => {
  useMockupStore.getState().update({ image })
  await act(async () => root.render(<ArtMockupWizard />))
  expect(container.textContent).not.toContain('Add to existing Nutshell lead')
  expect(container.querySelector('a[download]')?.getAttribute('href')).toBe(
    image.dataUrl,
  )
  await act(async () =>
    useMockupStore.getState().update({
      attachmentFailed: true,
      lastLead: { id: 42, advertiser: 'Alpine', name: 'Alpine campaign' },
    }),
  )
  expect(button('Retry image attachment')).toBeDefined()
})

it('blocks the wrong advertiser and requires explicit confirmation to retry the exact lead', async () => {
  useMockupStore.getState().update({
    image,
    attachmentFailed: true,
    lastLead: { id: 9, name: 'Wrong company', advertiser: 'Other' },
  })
  await act(async () => root.render(<AttachMockup />))
  await act(async () => button('Retry image attachment').click())
  expect(button('Confirm & attach image').disabled).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => button('Close').click())
  await act(async () =>
    useMockupStore.getState().recordSubmittedLead(42, 'Alpine', true),
  )
  await act(async () => button('Retry image attachment').click())
  expect(document.body.textContent).toContain('Confirm: Alpine (#42)')
  expect(fetch).not.toHaveBeenCalled()
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ target: { id: 42, name: 'Alpine', advertiser: 'Alpine' } }),
  )
  await act(async () => button('Confirm & attach image').click())
  expect(body()).toEqual({ leadId: 42, confirmedLeadId: 42, image })
  expect(useMockupStore.getState().state.attachmentFailed).toBe(false)
})

function SessionProbe() {
  useMockupSession()
  return null
}

it('clears active images when the authentication session expires', async () => {
  useMockupStore.getState().update({ image })
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
  await act(async () => root.render(<SessionProbe />))
  expect(useMockupStore.getState().sessionKey).toBeNull()
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(sessionStorage.getItem('billboard-active-mockup')).toBeNull()
})
