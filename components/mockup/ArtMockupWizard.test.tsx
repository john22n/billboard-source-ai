// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArtMockupWizard } from './ArtMockupWizard'
import { AttachMockup } from './AttachMockup'
import { ApprovalSummary } from './ApprovalSummary'
import { useMockupSession } from '@/hooks/useMockupSession'
import { useMockupStore } from '@/stores/mockupStore'
import { freshIntake, questions } from '@/lib/mockup/intake'

let root: Root
let container: HTMLDivElement
const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  advertiser: 'Alpine',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  receipt: 'signed',
}
const summary = {
  headline: 'Smile bigger',
  supporting: '',
  contact: '',
  direction: 'Bold',
  caution: '',
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  useMockupStore.getState().clear()
  useMockupStore.getState().initialize('rep:1')
  useMockupStore.getState().start({ entityName: 'Alpine' })
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
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve
    }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('alpine.example')
  expect(container.querySelector('textarea')?.disabled).toBe(true)
  await send('Duplicate')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual(
    {
      intake: { ...freshIntake(), advertiser: 'Alpine' },
      message: 'alpine.example',
      review: false,
    },
  )
  await act(async () =>
    finish(
      Response.json({
        intake: {
          ...freshIntake(),
          advertiser: 'Alpine',
          website: 'alpine.example',
        },
      }),
    ),
  )
  expect(container.querySelector('[role="log"]')?.textContent).toContain(
    questions.goal,
  )
  expect(container.querySelector('textarea')?.value).toBe('')
  expect(useMockupStore.getState().busy).toBe(false)
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
})

it('sends the latest copy request and retains the selected image and draft on failure', async () => {
  useMockupStore.getState().update({ image })
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'Try again later.' }, { status: 502 }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  await send('Remove the phone number')
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/mockup/generate')
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
  ).toMatchObject({
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
})

it('keeps only the orange summary and generate button, without the review section', async () => {
  useMockupStore
    .getState()
    .update({ summary: { ...summary, caution: 'Keep the headline short.' } })
  const generate = vi.fn()
  await act(async () =>
    root.render(<ApprovalSummary busy={false} onGenerate={generate} />),
  )
  expect(generate).not.toHaveBeenCalled()
  expect(container.querySelector('input, textarea')).toBeNull()
  expect(container.textContent).toContain('Keep the headline short.')
  expect(container.textContent).not.toContain('Smile bigger')
  expect(container.textContent).not.toContain('Visual direction')
  expect(container.textContent).not.toContain('Billboard summary')
  await act(async () => button('Generate mockup').click())
  expect(generate).toHaveBeenCalledTimes(1)
  await act(async () =>
    root.render(<ApprovalSummary busy onGenerate={generate} />),
  )
  expect(button('Generating mockup…').disabled).toBe(true)
})

it('preserves the selected image on revision failure and fences late responses after restart', async () => {
  useMockupStore.getState().update({ image, summary })
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'Provider unavailable' }, { status: 502 }),
  )
  await act(async () => root.render(<ArtMockupWizard />))
  const textarea = container.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  await act(async () => {
    setter.call(textarea, 'Bigger text')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(useMockupStore.getState().state.image).toEqual(image)
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    'Provider unavailable',
  )
  let finish!: (response: Response) => void
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(textarea.disabled).toBe(true)
  await act(async () => button('Start Mockup').click())
  await act(async () => finish(Response.json({ image, remaining: 8 })))
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(useMockupStore.getState().state.intake).toEqual(freshIntake())
})

it.each(['alpine.example', ''])(
  'sends brand evidence and exact approved contact copy (%s)',
  async (contact) => {
    const brand = {
      notes: 'Navy #123456 and gold #fedc98.',
      logo: null,
      receipt: null,
      fallback: '',
    }
    useMockupStore.getState().update({
      intake: {
        ...useMockupStore.getState().state.intake,
        website: 'alpine.example',
      },
      summary: { ...summary, contact },
      brand,
    })
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ image, remaining: 9 }),
    )
    await act(async () => root.render(<ArtMockupWizard />))
    await act(async () => button('Generate mockup').click())
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string),
    ).toMatchObject({
      summary: { contact },
      brandNotes: brand.notes,
    })
  },
)

it('blocks the wrong advertiser and requires explicit confirmation to retry the exact lead', async () => {
  useMockupStore.getState().update({
    image,
    lastLead: { id: 9, name: 'Wrong company', advertiser: 'Other' },
  })
  await act(async () => root.render(<AttachMockup />))
  await act(async () => button('Add to existing Nutshell lead').click())
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
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual(
    { leadId: 42, confirmedLeadId: 42, image },
  )
  expect(useMockupStore.getState().state.attachmentFailed).toBe(false)
})

function SessionProbe() {
  useMockupSession()
  return null
}

it('asks for clarification instead of repeating a question when extraction makes no progress', async () => {
  const intake = useMockupStore.getState().state.intake
  useMockupStore
    .getState()
    .update({ messages: [{ role: 'assistant', text: questions.website }] })
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ intake }))
  await act(async () => root.render(<ArtMockupWizard />))
  const textarea = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, 'I do not remember it')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  const messages = useMockupStore.getState().state.messages
  expect(
    messages.filter((message) => message.text === questions.website),
  ).toHaveLength(1)
  expect(messages.at(-1)?.text).toContain('rephrase')
  expect(useMockupStore.getState().state.intake.website).toBeNull()
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ intake: { ...intake, website: '' } }),
  )
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, 'skip')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(useMockupStore.getState().state.messages.at(-1)?.text).toBe(
    questions.goal,
  )
  expect(useMockupStore.getState().state.intake.advertiser).toBe('Alpine')
})

it('clears active images when the authentication session expires', async () => {
  useMockupStore.getState().update({ image })
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
  await act(async () => root.render(<SessionProbe />))
  expect(useMockupStore.getState().sessionKey).toBeNull()
  expect(useMockupStore.getState().state.image).toBeNull()
  expect(sessionStorage.getItem('billboard-active-mockup')).toBeNull()
})
