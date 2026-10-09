// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  closeSidebar: vi.fn(),
  closeMobileSidebar: vi.fn(),
  interimTranscript: 'Near Denver',
  transcripts: [
    {
      id: '1',
      text: 'Looking for billboards.',
      speaker: 'caller',
      timestamp: Date.parse('2026-09-24T14:35:00Z'),
    },
  ],
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/TwilioProvider', () => ({
  useTwilioContext: () => ({
    status: 'Ready',
    callActive: true,
    twilioReady: true,
    incomingCall: null,
    onCallAccepted: mocks.start,
    onCallDisconnected: mocks.stop,
    microphoneStatus: 'connected',
  }),
}))
vi.mock('@/hooks/useOpenAITranscription', () => ({
  useOpenAITranscription: () => ({
    transcripts: mocks.transcripts,
    interimTranscript: mocks.interimTranscript,
    interimSpeaker: 'caller',
    clearTranscripts: mocks.clear,
  }),
}))
vi.mock('@/hooks/useBillboardFormExtraction', () => ({
  useBillboardFormExtraction: () => ({ cleanup: mocks.cleanup }),
}))
vi.mock('@/hooks/useAutoLogout', () => ({ useAutoLogout: vi.fn() }))
vi.mock('@/hooks/useMockupSession', () => ({ useMockupSession: vi.fn() }))
vi.mock('@/components/mockup/ArtMockupWizard', () => ({
  ArtMockupWizard: () => <h2>Creative Studio</h2>,
}))
vi.mock('@/components/sales-call', async () => ({
  LeadForm: () => <input aria-label="Lead name" defaultValue="Alpine" />,
  PricingPanel: () => <p>Pricing</p>,
  InventoryExplorerPanel: () => null,
  TranscriptView: (await import('./sales-call/TranscriptView')).TranscriptView,
}))
vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({
    setOpen: mocks.closeSidebar,
    setOpenMobile: mocks.closeMobileSidebar,
  }),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <nav>{children}</nav>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

import SalesCallTranscriber from './SalesCallTranscriber'
import { NavMain } from './nav-main'
import { NavDocuments } from './nav-documents'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useFormStore } from '@/stores/formStore'
import { useMockupStore } from '@/stores/mockupStore'

it('keeps the lead and Nutshell submission beside Studio with grouped map navigation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ error: 'Complete the required fields' }, { status: 400 }),
    )
  vi.stubGlobal('fetch', fetcher)
  useDashboardStore.getState().setActiveTab('form')
  useFormStore.getState().updateField('entityName', 'Alpine')
  useMockupStore.getState().clear()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(<SalesCallTranscriber sessionIssuedAt={Date.now() / 1000} />),
    )
    const tools = container.querySelector(
      '[role="tablist"][aria-label="Lead tools"]',
    )
    expect(tools).not.toBeNull()
    const tabs = Array.from(
      tools!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Pricing',
      'Maps',
      'Inventory',
      'Creative Studio',
    ])
    const studio = tabs.find((tab) => tab.textContent === 'Creative Studio')!
    await act(async () =>
      studio.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      ),
    )
    expect(studio.getAttribute('aria-selected')).toBe('true')
    expect(
      container
        .querySelector('[aria-label="Lead name"]')
        ?.closest('[role="tabpanel"]')
        ?.getAttribute('data-state'),
    ).toBe('active')
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Nutshell',
    )!
    await act(async () => submit.click())
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty(
      'mockupImage',
    )
    const image = {
      id: '12345678-1234-4123-8123-123456789abc',
      advertiser: 'Alpine',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      receipt: 'signed',
    }
    await act(async () => useMockupStore.getState().update({ image }))
    await act(async () => submit.click())
    expect(fetcher.mock.calls[1][0]).toBe('/api/nutshell/create-lead')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      entityName: 'Alpine',
      mockupImage: image,
    })
  } finally {
    await act(async () => root.unmount())
    container.remove()
    useFormStore.getState().reset()
    useMockupStore.getState().clear()
    vi.unstubAllGlobals()
  }
})

it('opens the live transcript from the sidebar without clearing the lead or leaving the call', async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <>
          <NavMain items={[]} />
          <NavDocuments items={[]} />
          <SalesCallTranscriber sessionIssuedAt={Date.now() / 1000} />
        </>,
      ),
    )
    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    expect(tabs.some((tab) => tab.textContent?.includes('Transcript'))).toBe(
      false,
    )
    expect(
      tabs.some((tab) => tab.textContent?.includes('Creative Studio')),
    ).toBe(true)
    const lead = container.querySelector<HTMLInputElement>(
      '[aria-label="Lead name"]',
    )!
    lead.value = 'Unsaved lead'
    const transcript = Array.from(
      container.querySelectorAll('nav button'),
    ).find((button) => button.textContent === 'Transcript') as HTMLButtonElement
    expect(transcript).toBeDefined()
    expect(transcript.closest('nav')?.textContent).toMatch(/^HistoryTranscript/)
    expect(transcript.closest('nav')?.textContent).not.toContain(
      'No transcript',
    )
    expect(transcript.parentElement?.querySelector('time')?.dateTime).toBe(
      '2026-09-24T14:35:00.000Z',
    )
    await act(async () => transcript.click())
    const panel = container.querySelector(
      '[role="tabpanel"][aria-label="Transcript"][data-state="active"]',
    )!
    expect(panel.textContent).toContain('Looking for billboards.')
    expect(panel.textContent).toContain('Near Denver')
    expect(mocks.closeSidebar).toHaveBeenCalledWith(false)
    expect(mocks.closeMobileSidebar).toHaveBeenCalledWith(false)
    await act(async () => {
      const form = tabs.find((tab) => tab.textContent?.includes('Lead Form'))!
      form.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      )
    })
    expect(lead.closest('[role="tabpanel"]')?.getAttribute('data-state')).toBe(
      'active',
    )
    expect(container.querySelector('[aria-label="Lead name"]')).toBe(lead)
    expect(lead.value).toBe('Unsaved lead')
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.cleanup).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it('shows no transcript for empty text, shows live text, and removes the button after clearing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const originalTranscripts = mocks.transcripts
  const originalInterim = mocks.interimTranscript
  mocks.transcripts = [{ ...originalTranscripts[0], text: '  \n ' }]
  mocks.interimTranscript = ' '
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () =>
    root.render(
      <>
        <NavDocuments items={[]} />
        <SalesCallTranscriber sessionIssuedAt={Date.now() / 1000} />
      </>,
    )
  try {
    await act(async () => render())
    expect(container.querySelector('nav')?.textContent).toContain(
      'No transcript yet',
    )
    expect(container.querySelector('nav button')).toBeNull()
    expect(container.querySelector('nav time')).toBeNull()
    mocks.interimTranscript = 'A live caller answer'
    await act(async () => render())
    expect(container.querySelector('nav button')?.textContent).toBe(
      'Transcript',
    )
    expect(container.querySelector('nav time')).not.toBeNull()
    mocks.interimTranscript = ''
    mocks.transcripts = []
    await act(async () => render())
    expect(container.querySelector('nav')?.textContent).toContain(
      'No transcript yet',
    )
    expect(container.querySelector('nav button')).toBeNull()
    expect(container.querySelector('nav time')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    mocks.transcripts = originalTranscripts
    mocks.interimTranscript = originalInterim
    vi.unstubAllGlobals()
  }
})
