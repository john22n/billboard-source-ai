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
  transcripts: [
    {
      id: '1',
      text: 'Looking for billboards.',
      speaker: 'caller',
      timestamp: Date.now(),
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
    interimTranscript: 'Near Denver',
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

it('opens the live transcript from the sidebar without clearing the lead or leaving the call', async () => {
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
