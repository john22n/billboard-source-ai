import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const alertsList = vi.fn()
  const callsList = vi.fn()
  const eventsList = vi.fn()
  return {
    alertsList,
    callsList,
    eventsList,
    createOpenAI: vi.fn(),
    generateObject: vi.fn(),
    logOpenAITokenUsage: vi.fn(),
    openaiProvider: vi.fn(() => 'direct-openai-model'),
    requireAmpWebhookUrl: vi.fn(),
    requireOpenAIKey: vi.fn(),
    requireTwilioCredentials: vi.fn(),
    requireVercelCredentials: vi.fn(),
    twilioClient: {
      monitor: { v1: { alerts: { list: alertsList } } },
      calls: { list: callsList },
      taskrouter: {
        v1: {
          workspaces: vi.fn(() => ({ events: { list: eventsList } })),
        },
      },
    },
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))
vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('twilio', () => ({ default: vi.fn(() => mocks.twilioClient) }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    amp: { requireIssueWebhookUrl: mocks.requireAmpWebhookUrl },
    openai: { requireApiKey: mocks.requireOpenAIKey },
    taskRouter: { workspaceSid: 'WS123' },
    twilio: {
      mainNumber: '+18338547126',
      requireAccountCredentials: mocks.requireTwilioCredentials,
    },
    vercel: { requireRuntimeLogCredentials: mocks.requireVercelCredentials },
  },
}))
vi.mock('@/lib/dal', () => ({
  logOpenAITokenUsage: mocks.logOpenAITokenUsage,
}))

import {
  parseVercelRequestLogs,
  redactDiagnosticSecrets,
  submitIssueReport,
} from './issue-reporting'
import { issueReportSchema } from './issue-report-schema'

describe('issue reporting diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.alertsList.mockResolvedValue([])
    mocks.callsList.mockResolvedValue([])
    mocks.eventsList.mockResolvedValue([])
    mocks.createOpenAI.mockReturnValue(mocks.openaiProvider)
    mocks.requireAmpWebhookUrl.mockReturnValue(
      'https://webhooks.ampcode.com/example',
    )
    mocks.requireOpenAIKey.mockReturnValue('openai-key')
    mocks.requireTwilioCredentials.mockReturnValue({
      accountSid: 'AC123',
      authToken: 'twilio-token',
    })
    mocks.requireVercelCredentials.mockReturnValue({
      apiToken: 'vercel-token',
      projectId: 'project-1',
      deploymentId: 'deployment-1',
      teamId: 'team-1',
    })
  })

  it('redacts credentials while retaining contact details', () => {
    const input = [
      'authorization: Bearer secret-authorization',
      '"token":"xoxb-1234567890-secret"',
      'api_key=sk-1234567890abcdefghijkl',
      'sessionId="customer-session"',
      'alice@example.com',
      '+1 (212) 555-1212 and 2125551212 and +44 20 7946 0958',
      'https://user:password@example.com/private',
      '<@U123> <!channel> <#C123>',
    ].join('\n')

    const redacted = redactDiagnosticSecrets(input)

    expect(redacted).not.toMatch(
      /secret-authorization|xoxb-|sk-|customer-session|user:password|<[@!#]/,
    )
    expect(redacted).toContain('alice@example.com')
    expect(redacted).toContain('+1 (212) 555-1212')
    expect(redacted).toContain('2125551212')
    expect(redacted).toContain('+44 20 7946 0958')
    expect(redacted).toContain('authorization=[redacted]')
    expect(redacted).toContain('‹@U123> ‹!channel> ‹#C123>')
  })

  it('accepts bounded Vercel request logs inside the diagnostic window', () => {
    const occurredAt = new Date('2026-08-17T12:00:00.000Z')
    const validLog = {
      requestId: 'request-1',
      timestamp: occurredAt.toISOString(),
      deploymentId: 'deployment-1',
      domain: 'example.vercel.app',
      requestMethod: 'POST',
      requestPath: '/api/taskrouter/assignment',
      statusCode: 500,
      events: [{ source: 'serverless' }],
      logs: [
        { level: 'info', message: 'Assignment started' },
        { level: 'error', message: 'Function failed' },
      ],
    }

    expect(
      parseVercelRequestLogs(
        {
          rows: [
            validLog,
            {
              ...validLog,
              requestId: 'outside-range',
              timestamp: '2026-08-17T10:00:00.000Z',
            },
          ],
        },
        {
          start: new Date('2026-08-17T11:30:00.000Z'),
          end: new Date('2026-08-17T12:05:00.000Z'),
        },
      ),
    ).toEqual([
      {
        domain: 'example.vercel.app',
        level: 'error',
        message: '[info] Assignment started\n[error] Function failed',
        messageTruncated: false,
        requestMethod: 'POST',
        requestPath: '/api/taskrouter/assignment',
        responseStatusCode: 500,
        rowId: 'request-1',
        source: 'serverless',
        timestampInMs: occurredAt.getTime(),
      },
    ])
  })

  it('bounds the user-controlled report fields and diagnostic window', () => {
    const validReport = {
      requestId: crypto.randomUUID(),
      title: 'Calls fail to connect',
      description: 'Reps cannot accept inbound calls from the dashboard.',
      occurredAt: new Date().toISOString(),
      lookbackMinutes: 30,
    }

    expect(issueReportSchema.safeParse(validReport).success).toBe(true)
    expect(
      issueReportSchema.safeParse({
        ...validReport,
        description: 'x'.repeat(4001),
        lookbackMinutes: 181,
      }).success,
    ).toBe(false)
  })

  it('keeps diagnostics account-scoped and sends one handoff when OpenAI asks for help', async () => {
    const occurredAt = new Date()
    mocks.alertsList.mockResolvedValue([
      {
        sid: 'NO123',
        dateGenerated: occurredAt,
        logLevel: 'error',
        errorCode: '11200',
        alertText: 'Callback for alice@example.com used token=top-secret',
        requestMethod: 'POST',
        requestUrl: 'https://example.com/api/twilio?signature=secret',
        resourceSid: 'CA123',
        moreInfo: 'https://twilio.com/errors/11200?customer=alice',
      },
      {
        sid: 'NO999',
        dateGenerated: occurredAt,
        logLevel: 'error',
        errorCode: '11200',
        alertText: 'Callback failed for other-account@example.com',
        requestMethod: 'POST',
        requestUrl: 'https://example.com/api/twilio',
        resourceSid: 'CAOTHER',
        moreInfo: 'https://twilio.com/errors/11200',
      },
    ])
    mocks.callsList.mockResolvedValue([
      {
        sid: 'CA123',
        parentCallSid: null,
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+12125551212',
        to: '+18338547126',
        status: 'failed',
        duration: '0',
        direction: 'inbound',
        answeredBy: null,
      },
      {
        sid: 'CAEMPLOYEE',
        parentCallSid: 'CA123',
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+18338547126',
        to: 'client:admin@example.com',
        status: 'failed',
        duration: '0',
        direction: 'outbound-dial',
        answeredBy: null,
      },
      {
        sid: 'CAOTHER',
        parentCallSid: 'CA123',
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+18338547126',
        to: 'client:other-account@example.com',
        status: 'failed',
        duration: '0',
        direction: 'outbound-dial',
        answeredBy: null,
      },
    ])
    mocks.eventsList.mockResolvedValue([])
    mocks.generateObject.mockResolvedValue({
      object: {
        severity: 'high',
        summary: 'Likely callback failure for alice@example.com <!channel>.',
        evidence: [{ source: 'twilio', detail: 'Error 11200 was recorded.' }],
        missingData: [],
        needsAmpEscalation: true,
        escalationReason: 'The callback implementation needs investigation.',
        twilioCallInfoRequested: true,
      },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })

    const vercelLog = {
      requestId: 'row-1',
      timestamp: occurredAt.toISOString(),
      deploymentId: 'deployment-1',
      domain: 'example.vercel.app',
      requestMethod: 'POST',
      requestPath: '/api/twilio?signature=secret',
      statusCode: 500,
      events: [{ source: 'serverless' }],
      logs: [
        {
          level: 'error',
          message: 'token=vercel-secret for CA123 and alice@example.com',
          messageTruncated: false,
        },
      ],
    }
    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, _init?: RequestInit) => {
        void _init
        if (
          String(input).startsWith('https://vercel.com/api/logs/request-logs')
        ) {
          return Response.json({
            rows: [
              vercelLog,
              {
                ...vercelLog,
                requestId: 'other-row',
                logs: [
                  {
                    level: 'error',
                    message:
                      'CAOTHER failed for other-account@example.com at +16465550199',
                    messageTruncated: false,
                  },
                ],
              },
            ],
          })
        }
        return new Response(null, { status: 202 })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitIssueReport({
      input: {
        requestId: '12345678-1234-4234-8234-123456789012',
        title: 'Calls fail <!channel>',
        description:
          'Customer alice@example.com at 212-555-1212 could not connect.',
        occurredAt: occurredAt.toISOString(),
        lookbackMinutes: 30,
      },
      reporter: {
        id: 'admin-1',
        email: 'admin@example.com',
        twilioPhoneNumber: '+12125559876',
        taskRouterWorkerSid: 'WKADMIN',
      },
    })

    const modelPrompt = mocks.generateObject.mock.calls[0][0].prompt as string
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: 'openai-key' })
    expect(mocks.openaiProvider).toHaveBeenCalledWith('gpt-4o-mini')
    expect(modelPrompt).toContain('alice@example.com')
    expect(modelPrompt).toContain('212-555-1212')
    expect(modelPrompt).toContain('+12125551212')
    expect(modelPrompt).not.toMatch(
      /top-secret|vercel-secret|signature=secret|<[@!#]|CAOTHER|other-account@example\.com|\+16465550199/,
    )
    expect(mocks.eventsList).toHaveBeenCalledWith(
      expect.objectContaining({ workerSid: 'WKADMIN' }),
    )

    const vercelCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('https://vercel.com/api/logs/request-logs'),
    )
    const vercelUrl = new URL(String(vercelCall?.[0]))
    expect(vercelUrl.searchParams.get('projectId')).toBe('project-1')
    expect(vercelUrl.searchParams.get('ownerId')).toBe('team-1')
    expect(vercelUrl.searchParams.get('deploymentId')).toBe('deployment-1')
    expect(vercelUrl.searchParams.get('startDate')).toBe(
      String(occurredAt.getTime() - 30 * 60 * 1000),
    )

    const ampCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('https://webhooks.ampcode.com/'),
    )
    const ampBody = JSON.parse(
      String((ampCall?.[1] as RequestInit | undefined)?.body),
    ) as { version: number; type: string; reportId: string; message: string }
    expect(new Headers(ampCall?.[1]?.headers).get('Idempotency-Key')).toBe(
      'ISS-12345678',
    )
    expect(new Headers(ampCall?.[1]?.headers).has('Authorization')).toBe(false)
    expect(ampBody).toMatchObject({
      version: 1,
      type: 'billboard-source.issue-reported',
      reportId: 'ISS-12345678',
    })
    expect(ampBody.message).toContain('admin@example.com')
    expect(ampBody.message).toContain('alice@example.com')
    expect(ampBody.message).toContain('212-555-1212')
    expect(ampBody.message).toContain('+12125551212')
    expect(ampBody.message).not.toMatch(
      /top-secret|vercel-secret|signature=secret|<!channel>|<#C123>|CAOTHER|other-account@example\.com|\+16465550199|Recommended actions/,
    )
    expect(result).toMatchObject({
      reportId: 'ISS-12345678',
      unavailableSources: [],
      ampEscalated: true,
      diagnosis: {
        twilioCallInfoRequested: true,
        twilioCallContext: {
          phoneNumbers: ['+12125551212'],
          emailAddresses: ['alice@example.com'],
          calls: [
            expect.objectContaining({
              callSid: 'CA123',
              from: '+12125551212',
              to: '+18338547126',
            }),
            expect.objectContaining({
              callSid: 'CAEMPLOYEE',
              parentCallSid: 'CA123',
              to: 'client:admin@example.com',
            }),
          ],
        },
      },
    })
    expect(result.diagnosis).not.toHaveProperty('recommendedActions')
  })

  it('does not call Amp when OpenAI can explain the reason', async () => {
    mocks.generateObject.mockResolvedValue({
      object: {
        severity: 'low',
        summary: 'The worker was offline when TaskRouter attempted assignment.',
        evidence: [
          { source: 'report', detail: 'The worker is shown as offline.' },
        ],
        missingData: [],
        needsAmpEscalation: false,
        escalationReason: null,
        twilioCallInfoRequested: false,
      },
      usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
    })
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      if (
        String(input).startsWith('https://vercel.com/api/logs/request-logs')
      ) {
        return Response.json({ rows: [] })
      }
      throw new Error('Amp should not be called')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitIssueReport({
      input: {
        requestId: '23456789-1234-4234-8234-123456789012',
        title: 'Worker appears offline',
        description: 'The worker cannot receive calls and appears offline.',
        occurredAt: new Date().toISOString(),
        lookbackMinutes: 30,
      },
      reporter: { id: 'user-1', email: 'user@example.com' },
    })

    expect(result.ampEscalated).toBe(false)
    expect(result.diagnosis.twilioCallContext).toBeNull()
    expect(result.diagnosis).not.toHaveProperty('recommendedActions')
    expect(mocks.requireAmpWebhookUrl).not.toHaveBeenCalled()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith('https://webhooks.ampcode.com/'),
      ),
    ).toBe(false)
  })

  it('retrieves only the employee account call context when OpenAI is unavailable', async () => {
    const occurredAt = new Date()
    mocks.alertsList.mockResolvedValue([
      {
        sid: 'NO456',
        dateGenerated: occurredAt,
        logLevel: 'info',
        errorCode: '0',
        alertText: 'Caller record belongs to caller@example.com',
        requestMethod: 'POST',
        requestUrl: 'https://example.com/api/twilio',
        resourceSid: 'CA456',
        moreInfo: 'https://twilio.com/docs',
      },
    ])
    mocks.callsList.mockResolvedValue([
      {
        sid: 'CA456',
        parentCallSid: null,
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+12125550199',
        to: '+12125559876',
        status: 'completed',
        duration: '120',
        direction: 'inbound',
        answeredBy: null,
      },
      {
        sid: 'CAOTHER',
        parentCallSid: null,
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+16465550199',
        to: '+16465550999',
        status: 'completed',
        duration: '90',
        direction: 'inbound',
        answeredBy: null,
      },
    ])
    mocks.requireVercelCredentials.mockImplementation(() => {
      throw new Error('Vercel unavailable')
    })
    mocks.generateObject.mockRejectedValue(new Error('OpenAI unavailable'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 202 })),
    )

    const result = await submitIssueReport({
      input: {
        requestId: '34567890-1234-4234-8234-123456789012',
        title: 'Need the last Twilio call details',
        description:
          'Please retrieve the number, email, and duration from the Twilio call I just had.',
        occurredAt: occurredAt.toISOString(),
        lookbackMinutes: 30,
      },
      reporter: {
        id: 'user-1',
        email: 'user@example.com',
        twilioPhoneNumber: '+12125559876',
      },
    })

    expect(result.diagnosis.twilioCallInfoRequested).toBe(true)
    expect(result.diagnosis.twilioCallContext).toEqual({
      phoneNumbers: ['+12125550199'],
      emailAddresses: ['caller@example.com'],
      calls: [
        {
          callSid: 'CA456',
          parentCallSid: null,
          startedAt: occurredAt.toISOString(),
          endedAt: occurredAt.toISOString(),
          from: '+12125550199',
          to: '+12125559876',
          status: 'completed',
          durationSeconds: 120,
          direction: 'inbound',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(/CAOTHER|\+16465550199/)
    expect(result.ampEscalated).toBe(true)
  })

  it('still hands the report to Amp when diagnostic providers are unavailable', async () => {
    mocks.requireTwilioCredentials.mockImplementation(() => {
      throw new Error('Twilio unavailable')
    })
    mocks.requireVercelCredentials.mockImplementation(() => {
      throw new Error('Vercel unavailable')
    })
    mocks.generateObject.mockRejectedValue(new Error('OpenAI unavailable'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 202 })),
    )

    const result = await submitIssueReport({
      input: {
        requestId: '87654321-1234-4234-8234-123456789012',
        title: 'Calls fail to connect',
        description: 'Reps cannot accept inbound calls from the dashboard.',
        occurredAt: new Date().toISOString(),
        lookbackMinutes: 30,
      },
      reporter: { id: 'admin-1', email: 'admin@example.com' },
    })

    expect(result.unavailableSources).toEqual(['Twilio', 'Vercel', 'OpenAI'])
    expect(result.diagnosis.summary).toContain(
      'a reason could not be determined',
    )
    expect(result.diagnosis.twilioCallInfoRequested).toBe(false)
    expect(result.diagnosis.twilioCallContext).toBeNull()
    expect(result.ampEscalated).toBe(true)
    expect(mocks.requireAmpWebhookUrl).toHaveBeenCalledOnce()
  })
})
