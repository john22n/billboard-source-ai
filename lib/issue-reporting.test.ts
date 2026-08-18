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
    requireOpenAIKey: vi.fn(),
    requireSlackCredentials: vi.fn(),
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
    openai: { requireApiKey: mocks.requireOpenAIKey },
    slack: { requireIssueReportingCredentials: mocks.requireSlackCredentials },
    taskRouter: { workspaceSid: 'WS123' },
    twilio: { requireAccountCredentials: mocks.requireTwilioCredentials },
    vercel: { requireRuntimeLogCredentials: mocks.requireVercelCredentials },
  },
}))
vi.mock('@/lib/dal', () => ({
  logOpenAITokenUsage: mocks.logOpenAITokenUsage,
}))

import {
  parseVercelRequestLogs,
  redactDiagnosticText,
  submitIssueReport,
} from './issue-reporting'
import { issueReportSchema } from './issue-report-schema'

describe('issue reporting diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOpenAI.mockReturnValue(mocks.openaiProvider)
    mocks.requireOpenAIKey.mockReturnValue('openai-key')
    mocks.requireSlackCredentials.mockReturnValue({
      userToken: 'slack-user-token',
      ampChannelId: 'DAMP123',
      ampUserId: 'UAMP123',
    })
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

  it('redacts credentials, contact details, and Slack control syntax', () => {
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

    const redacted = redactDiagnosticText(input)

    expect(redacted).not.toMatch(
      /secret-authorization|xoxb-|sk-|customer-session|alice@example|555-1212|2125551212|7946 0958|user:password|<[@!#]/,
    )
    expect(redacted).toContain('[email redacted]')
    expect(redacted).toContain('[phone redacted]')
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

  it('sanitizes provider evidence before OpenAI and sends one Amp handoff', async () => {
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
    ])
    mocks.callsList.mockResolvedValue([
      {
        sid: 'CA123',
        parentCallSid: null,
        startTime: occurredAt,
        endTime: occurredAt,
        from: '+12125551212',
        to: '+12125559876',
        status: 'failed',
        duration: '0',
        direction: 'inbound',
        answeredBy: null,
      },
    ])
    mocks.eventsList.mockResolvedValue([])
    mocks.generateObject.mockResolvedValue({
      object: {
        severity: 'high',
        summary: 'Likely callback failure for alice@example.com <!channel>.',
        likelyCauses: ['The callback returned HTTP 500.'],
        evidence: [{ source: 'twilio', detail: 'Error 11200 was recorded.' }],
        recommendedActions: ['Inspect the callback response.'],
        missingData: [],
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
          message: 'token=vercel-secret for alice@example.com',
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
          return Response.json({ rows: [vercelLog] })
        }
        return Response.json({ ok: true, channel: 'D123', ts: '123.456' })
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
      reporter: { id: 'admin-1', email: 'admin@example.com' },
    })

    const modelPrompt = mocks.generateObject.mock.calls[0][0].prompt as string
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: 'openai-key' })
    expect(mocks.openaiProvider).toHaveBeenCalledWith('gpt-4o-mini')
    expect(modelPrompt).not.toMatch(
      /alice@example|212-555-1212|top-secret|vercel-secret|signature=secret|<[@!#]/,
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

    const slackCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('https://slack.com/'),
    )
    const slackBody = JSON.parse(
      String((slackCall?.[1] as RequestInit | undefined)?.body),
    ) as { channel: string; text: string }
    expect(new Headers(slackCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer slack-user-token',
    )
    expect(slackBody.channel).toBe('DAMP123')
    expect(slackBody.text).toContain('<@UAMP123>')
    expect(slackBody.text).toContain('admin@example.com')
    expect(slackBody.text).not.toMatch(
      /alice@example|212-555-1212|top-secret|vercel-secret|signature=secret|<!channel>|<#C123>/,
    )
    expect(result).toMatchObject({
      reportId: 'ISS-12345678',
      slackChannelId: 'D123',
      slackMessageTs: '123.456',
      unavailableSources: [],
    })
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
      vi.fn(async () =>
        Response.json({ ok: true, channel: 'D123', ts: '123.456' }),
      ),
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
    expect(result.diagnosis.summary).toContain('OpenAI triage was unavailable')
  })
})
