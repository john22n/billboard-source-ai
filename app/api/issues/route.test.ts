import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  clearExpiredReportedIssues,
  getReportedIssues,
  getSession,
  rateLimit,
  resetRateLimit,
  resolveReportedIssue,
  saveReportedIssue,
  submitIssueReport,
} = vi.hoisted(() => ({
  clearExpiredReportedIssues: vi.fn(),
  getReportedIssues: vi.fn(),
  getSession: vi.fn(),
  rateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  resolveReportedIssue: vi.fn(),
  saveReportedIssue: vi.fn(),
  submitIssueReport: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/config', () => ({
  configErrorResponseBody: vi.fn(),
  isMissingConfig: vi.fn(() => false),
}))
vi.mock('@/lib/dal', () => ({
  clearExpiredReportedIssues,
  getReportedIssues,
  resolveReportedIssue,
  saveReportedIssue,
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
    issueResolutionSchema: z.object({
      reportId: z.string().regex(/^ISS-[A-F0-9]{8}$/),
    }),
  }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimit, resetRateLimit }))
vi.mock('@/lib/issue-reporting', () => {
  class IssueReportDeliveryError extends Error {
    constructor(
      readonly status: number,
      readonly publicMessage: string,
    ) {
      super(publicMessage)
    }
  }

  return {
    IssueReportDeliveryError,
    redactDiagnosticSecrets: (value: string) => value,
    submitIssueReport,
  }
})

import { GET, PATCH, POST } from './route'

const validInput = () => ({
  requestId: crypto.randomUUID(),
  title: 'Calls fail to connect',
  description: 'Reps cannot accept inbound calls from the dashboard.',
  occurredAt: new Date().toISOString(),
  lookbackMinutes: 30,
})

function request(body: unknown, method = 'POST') {
  return new NextRequest('https://example.com/api/issues', {
    method,
    body: JSON.stringify(body),
  })
}

describe('/api/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      twilioPhoneNumber: '+12125550100',
      taskRouterWorkerSid: 'WKADMIN',
      activeCallSid: 'CAADMIN',
    })
    rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    resetRateLimit.mockResolvedValue(undefined)
    clearExpiredReportedIssues.mockResolvedValue(0)
    getReportedIssues.mockResolvedValue([])
    saveReportedIssue.mockResolvedValue({ reportId: 'ISS-12345678' })
    submitIssueReport.mockResolvedValue({
      reportId: 'ISS-12345678',
      diagnosis: {
        severity: 'high',
        summary: 'A Twilio assignment failed.',
        evidence: [],
        missingData: [],
        needsAmpEscalation: false,
        escalationReason: null,
        twilioCallInfoRequested: false,
        twilioCallContext: null,
      },
      unavailableSources: [],
      ampEscalated: false,
    })
    resolveReportedIssue.mockResolvedValue({
      reportId: 'ISS-12345678',
      resolvedAt: new Date(),
    })
  })

  it('rejects unauthenticated users', async () => {
    getSession.mockResolvedValueOnce(null)
    const response = await POST(request(validInput()))

    expect(response.status).toBe(401)
    expect(submitIssueReport).not.toHaveBeenCalled()
  })

  it('allows a signed-in employee to submit a report', async () => {
    getSession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'user',
      twilioPhoneNumber: '+12125550101',
      taskRouterWorkerSid: 'WKUSER',
      activeCallSid: 'CAUSER',
    })
    const response = await POST(request(validInput()))

    expect(response.status).toBe(200)
    expect(submitIssueReport).toHaveBeenCalledWith({
      input: expect.objectContaining({ title: 'Calls fail to connect' }),
      reporter: {
        id: 'user-1',
        email: 'user@example.com',
        twilioPhoneNumber: '+12125550101',
        taskRouterWorkerSid: 'WKUSER',
        activeCallSid: 'CAUSER',
      },
    })
  })

  it('allows an admin user to submit a report', async () => {
    const response = await POST(request(validInput()))

    expect(response.status).toBe(200)
    expect(submitIssueReport).toHaveBeenCalledWith({
      input: expect.objectContaining({ title: 'Calls fail to connect' }),
      reporter: {
        id: 'admin-1',
        email: 'admin@example.com',
        twilioPhoneNumber: '+12125550100',
        taskRouterWorkerSid: 'WKADMIN',
        activeCallSid: 'CAADMIN',
      },
    })
    expect(saveReportedIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'ISS-12345678',
        reporterId: 'admin-1',
        title: 'Calls fail to connect',
      }),
    )
    expect(rateLimit).toHaveBeenCalledWith(
      'issue-report-daily',
      'admin-1',
      1,
      57_600,
    )
  })

  it('limits each employee account to one report every 16 hours', async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 })

    const response = await POST(request(validInput()))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    await expect(response.json()).resolves.toEqual({
      error: 'Each account can report one issue every 16 hours.',
    })
    expect(submitIssueReport).not.toHaveBeenCalled()
  })

  it('restores the reporting allowance when a report fails', async () => {
    submitIssueReport.mockRejectedValue(new Error('provider unavailable'))

    const response = await POST(request(validInput()))

    expect(response.status).toBe(500)
    expect(resetRateLimit).toHaveBeenCalledWith('issue-report-daily', 'admin-1')
  })

  it('lists only retained issues for an admin user', async () => {
    getReportedIssues.mockResolvedValue([{ reportId: 'ISS-12345678' }])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(clearExpiredReportedIssues).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toEqual({
      issues: [{ reportId: 'ISS-12345678' }],
    })
  })

  it('allows an admin user to resolve an issue', async () => {
    const response = await PATCH(request({ reportId: 'ISS-12345678' }, 'PATCH'))

    expect(response.status).toBe(200)
    expect(resolveReportedIssue).toHaveBeenCalledWith('ISS-12345678', 'admin-1')
  })

  it('does not allow non-admin users to resolve an issue', async () => {
    getSession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'user',
    })

    const response = await PATCH(request({ reportId: 'ISS-12345678' }, 'PATCH'))

    expect(response.status).toBe(403)
    expect(resolveReportedIssue).not.toHaveBeenCalled()
  })
})
