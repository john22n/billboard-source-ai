import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  accepted: vi.fn(),
  missed: vi.fn(),
  taskFetch: vi.fn(),
  taskUpdate: vi.fn(),
  workerUpdate: vi.fn(),
}))

vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/call-attempt-outcomes', () => ({
  recordAcceptedAttempt: mocks.accepted,
  recordMissedAttempt: mocks.missed,
}))
vi.mock('@/lib/taskrouter-retry-routing', () => ({
  buildOverflowRedirectTwiml: () =>
    '<Response><Redirect>overflow</Redirect></Response>',
  buildRequeueTwiml: () => '<Response><Enqueue>retry</Enqueue></Response>',
  computeMissedAttemptRouting: (attributes: Record<string, unknown>) => ({
    excludedWorkers: ['WKrep'],
    attemptCount: 1,
    directFallbackOffered: false,
    shouldOverflow: false,
    nextTaskAttributes: attributes,
  }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    app: {
      baseUrlFromRequest: () => 'https://app.example',
    },
    taskRouter: {
      requireWorkspaceSid: () => 'WSworkspace',
      requireActivitySids: () => ({ busy: 'WAbusy', available: 'WAavailable' }),
    },
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'ACtest',
        authToken: 'test',
      }),
    },
  },
}))
vi.mock('twilio', () => ({
  default: () => ({
    taskrouter: {
      v1: {
        workspaces: () => ({
          tasks: () => ({
            fetch: mocks.taskFetch,
            update: mocks.taskUpdate,
          }),
          workers: () => ({ update: mocks.workerUpdate }),
        }),
      },
    },
  }),
}))

import { POST } from './route'

function request(fields: Record<string, string>) {
  return new Request(
    'https://app.example/api/taskrouter/simultaneous-dial-complete?taskSid=WTtask&workspaceSid=WSworkspace&workerSid=WKrep&reservationSid=WRreservation',
    { method: 'POST', body: new URLSearchParams(fields) },
  )
}

describe('simultaneous dial completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.taskFetch.mockResolvedValue({
      assignmentStatus: 'assigned',
      attributes: JSON.stringify({
        call_sid: 'CAcaller',
        from: '+12025550129',
      }),
    })
    mocks.taskUpdate.mockResolvedValue({})
    mocks.workerUpdate.mockResolvedValue({})
  })

  it('does not accept a long screening leg that was never bridged', async () => {
    const response = await POST(
      request({
        DialCallStatus: 'completed',
        DialCallDuration: '8',
        DialBridged: 'false',
        DialCallSid: 'CAcell',
      }),
    )

    expect(await response.text()).toContain('<Enqueue>retry</Enqueue>')
    expect(mocks.accepted).not.toHaveBeenCalled()
    expect(mocks.missed).toHaveBeenCalledWith({
      reservationSid: 'WRreservation',
      workerSid: 'WKrep',
    })
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      assignmentStatus: 'completed',
      reason: 'Simultaneous dial finished: no-answer',
    })
  })

  it('accepts a bridged call regardless of its duration', async () => {
    const response = await POST(
      request({
        DialCallStatus: 'completed',
        DialCallDuration: '1',
        DialBridged: 'true',
        DialCallSid: 'CAcell',
      }),
    )

    expect(await response.text()).toContain('<Hangup/>')
    expect(mocks.accepted).toHaveBeenCalledWith({
      reservationSid: 'WRreservation',
      workerSid: 'WKrep',
    })
    expect(mocks.missed).not.toHaveBeenCalled()
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      assignmentStatus: 'completed',
      reason: 'Simultaneous dial completed successfully',
    })
  })
})
