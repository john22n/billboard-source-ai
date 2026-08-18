import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, rateLimit, submitIssueReport } = vi.hoisted(() => ({
  getSession: vi.fn(),
  rateLimit: vi.fn(),
  submitIssueReport: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/config', () => ({
  configErrorResponseBody: vi.fn(),
  isMissingConfig: vi.fn(() => false),
}))
vi.mock('@/lib/issue-report-schema', async () => {
  const { z } = await import('zod')
  return {
    issueReportSchema: z.object({
      requestId: z.string().uuid(),
      title: z.string().trim().min(5).max(120),
      description: z.string().trim().min(20).max(4000),
      occurredAt: z.string().datetime({ offset: true }),
      lookbackMinutes: z.number().int().min(15).max(180),
    }),
  }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimit }))
vi.mock('@/lib/issue-reporting', () => {
  class IssueReportDeliveryError extends Error {
    constructor(
      readonly status: number,
      readonly publicMessage: string,
    ) {
      super(publicMessage)
    }
  }

  return { IssueReportDeliveryError, submitIssueReport }
})

import { POST } from './route'

const validInput = () => ({
  requestId: crypto.randomUUID(),
  title: 'Calls fail to connect',
  description: 'Reps cannot accept inbound calls from the dashboard.',
  occurredAt: new Date().toISOString(),
  lookbackMinutes: 30,
})

function request(body: unknown) {
  return new NextRequest('https://example.com/api/issues', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
    })
    rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    submitIssueReport.mockResolvedValue({
      reportId: 'ISS-12345678',
      slackChannelId: 'DAMP123',
      slackMessageTs: '123.456',
      diagnosis: {
        severity: 'high',
        summary: 'A Twilio assignment failed.',
        likelyCauses: [],
        evidence: [],
        recommendedActions: ['Review the assignment callback.'],
        missingData: [],
      },
      unavailableSources: [],
    })
  })

  it('rejects unauthenticated users', async () => {
    getSession.mockResolvedValueOnce(null)
    const response = await POST(request(validInput()))

    expect(response.status).toBe(401)
    expect(submitIssueReport).not.toHaveBeenCalled()
  })

  it('rejects non-admin users', async () => {
    getSession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'user',
    })
    const response = await POST(request(validInput()))

    expect(response.status).toBe(403)
    expect(submitIssueReport).not.toHaveBeenCalled()
  })

  it('allows an admin user to submit a report', async () => {
    const response = await POST(request(validInput()))

    expect(response.status).toBe(200)
    expect(submitIssueReport).toHaveBeenCalledWith({
      input: expect.objectContaining({ title: 'Calls fail to connect' }),
      reporter: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('rate limits repeated reports before gathering provider logs', async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 })

    const response = await POST(request(validInput()))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(submitIssueReport).not.toHaveBeenCalled()
  })
})
