import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }))
vi.mock('@/components/SidebarOverlay', () => ({ SidebarOverlay: () => null }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => children,
  SidebarProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/SalesCallTranscriber', () => ({
  default: () => null,
}))

import SalesCallTranscriber from '@/components/SalesCallTranscriber'
import Page from './page'

function findElement(node: ReactNode, type: unknown): ReactNode {
  if (!isValidElement(node)) return null
  if (node.type === type) return node
  const children = (node.props as { children?: ReactNode }).children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, type)
      if (found) return found
    }
    return null
  }
  return findElement(children, type)
}

describe('dashboard call-session protection', () => {
  it('uses the renewed session time after a call extends the JWT', async () => {
    getSession.mockResolvedValue({
      userId: 'user-1',
      email: 'rep@example.com',
      role: 'user',
      issuedAt: 200,
      sessionStartedAt: 100,
      activeCallSid: `CA${'a'.repeat(32)}`,
    })

    const page = await Page()
    const transcriber = findElement(page, SalesCallTranscriber)

    expect(transcriber).not.toBeNull()
    expect(
      (transcriber as { props: { sessionIssuedAt: number } }).props
        .sessionIssuedAt,
    ).toBe(200)
  })
})
