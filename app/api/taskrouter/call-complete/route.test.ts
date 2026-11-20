import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchTask: vi.fn(),
  updateTask: vi.fn(),
  participants: vi.fn(),
  fetchCall: vi.fn(),
  updateCall: vi.fn(),
  missed: vi.fn(),
  httpClient: { lastResponse: { headers: { etag: '0' } } },
}))
vi.mock('@/lib/twilio-webhook', () => ({
  isValidTwilioWebhook: async () => true,
}))
vi.mock('@/lib/call-attempt-outcomes', () => ({
  recordMissedAttempt: mocks.missed,
}))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'ACtest',
        authToken: 'test',
      }),
    },
    app: {
      baseUrlFromRequest: () => 'https://app.example',
      addVercelBypassToken: (url: URL) => url,
    },
  },
}))
vi.mock('twilio', () => ({
  default: () => ({
    httpClient: mocks.httpClient,
    taskrouter: {
      v1: {
        workspaces: () => ({
          tasks: () => ({ fetch: mocks.fetchTask, update: mocks.updateTask }),
        }),
      },
    },
    conferences: () => ({ participants: { list: mocks.participants } }),
    calls: () => ({ fetch: mocks.fetchCall, update: mocks.updateCall }),
  }),
}))

import { POST } from './route'

let attributes: Record<string, unknown>
let status: string
let version: number
let destination: URL | undefined
function request() {
  return new Request(
    'https://app.example/api/taskrouter/call-complete?taskSid=WTtest&workspaceSid=WStest&workerSid=WKtest&reservationSid=WRtest',
    {
      method: 'POST',
      body: new URLSearchParams({
        StatusCallbackEvent: 'conference-end',
        ConferenceSid: 'CFtest',
      }),
    },
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  status = 'assigned'
  version = 0
  mocks.httpClient.lastResponse.headers.etag = '0'
  destination = undefined
  attributes = {
    call_sid: 'CAcaller',
    call_offer: {
      workerSid: 'WKtest',
      reservationSid: 'WRtest',
      status: 'ringing',
      channel: null,
    },
  }
  mocks.fetchTask.mockImplementation(async () => {
    mocks.httpClient.lastResponse.headers.etag = String(version)
    return { assignmentStatus: status, attributes: JSON.stringify(attributes) }
  })
  // Twilio disallows changing attributes and completing a task in one request.
  mocks.updateTask.mockImplementation(async (update) => {
    if (update.ifMatch !== undefined && update.ifMatch !== String(version))
      throw { status: 412 }
    if (update.attributes && update.assignmentStatus)
      throw Object.assign(new Error('Separate updates required'), {
        status: 400,
        code: 400,
      })
    if (update.attributes) attributes = JSON.parse(update.attributes)
    if (update.assignmentStatus) status = update.assignmentStatus
    mocks.httpClient.lastResponse.headers.etag = String(++version)
    return {}
  })
  mocks.participants.mockResolvedValue([])
  mocks.fetchCall.mockResolvedValue({ status: 'in-progress' })
  mocks.updateCall.mockImplementation(async ({ url }) => {
    destination = new URL(url)
    return {}
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('persists retry routing, completes the task and redirects the live caller only once', async () => {
  expect((await POST(request())).status).toBe(200)
  expect(status).toBe('completed')
  expect(attributes).toMatchObject({
    excluded_workers: ['WKtest'],
    attempt_count: 1,
  })
  expect(destination?.pathname).toBe('/api/taskrouter/retry-or-overflow')
  expect(destination?.searchParams.get('callSid')).toBe('CAcaller')
  await POST(request())
  expect(mocks.updateCall).toHaveBeenCalledTimes(1)
})

it('does not retry an answered conference after its participants have left', async () => {
  attributes.call_offer = {
    workerSid: 'WKtest',
    reservationSid: 'WRtest',
    status: 'answered',
    channel: 'browser',
  }
  expect((await POST(request())).status).toBe(200)
  expect(status).toBe('completed')
  expect(destination).toBeUndefined()
  expect(mocks.missed).not.toHaveBeenCalled()
})

it('acknowledges a caller hanging up during redirect without an error', async () => {
  mocks.updateCall.mockRejectedValue({ status: 400, code: 21220 })
  expect((await POST(request())).status).toBe(200)
  expect(status).toBe('completed')
  expect(console.error).not.toHaveBeenCalled()
})

it.each(['completed', 'canceled'])(
  'acknowledges a task concurrently becoming %s without redirecting',
  async (terminalStatus) => {
    mocks.updateTask.mockImplementationOnce(async () => {
      status = terminalStatus
      throw { status: 400, code: 401 }
    })
    expect((await POST(request())).status).toBe(200)
    expect(destination).toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
  },
)

it('does not mistake an invalid redirect for a concurrent task completion', async () => {
  mocks.updateCall.mockRejectedValue({ status: 400, code: 21205 })
  expect((await POST(request())).status).toBe(500)
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('21205')
})

it('resumes a failed redirect on redelivery without counting a new attempt', async () => {
  mocks.updateCall.mockRejectedValueOnce({ status: 503, code: 20500 })
  expect((await POST(request())).status).toBe(500)
  expect((await POST(request())).status).toBe(200)
  expect(destination?.pathname).toBe('/api/taskrouter/retry-or-overflow')
  expect(attributes.attempt_count).toBe(1)
  await POST(request())
  expect(mocks.updateCall).toHaveBeenCalledTimes(2)
})

it('re-reads an answer saved while the end callback was updating the task', async () => {
  const update = mocks.updateTask.getMockImplementation()!
  mocks.updateTask.mockImplementationOnce(async (input) => {
    attributes.call_offer = {
      workerSid: 'WKtest',
      reservationSid: 'WRtest',
      status: 'answered',
      channel: 'browser',
    }
    version++
    return update(input)
  })
  expect((await POST(request())).status).toBe(200)
  expect(attributes.call_offer).toMatchObject({ status: 'answered' })
  expect(status).toBe('completed')
  expect(destination).toBeUndefined()
})

it('resumes after the attributes update succeeds but completion fails', async () => {
  const update = mocks.updateTask.getMockImplementation()!
  mocks.updateTask
    .mockImplementationOnce(update)
    .mockRejectedValueOnce({ status: 503 })
  expect((await POST(request())).status).toBe(500)
  expect((await POST(request())).status).toBe(200)
  expect(status).toBe('completed')
  expect(attributes.attempt_count).toBe(1)
  expect(destination?.pathname).toBe('/api/taskrouter/retry-or-overflow')
})

it('reports unexpected Twilio failures without leaking provider messages', async () => {
  mocks.updateTask.mockRejectedValue({
    status: 503,
    code: 20500,
    message: 'private caller information',
  })
  expect((await POST(request())).status).toBe(500)
  expect(destination).toBeUndefined()
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('20500')
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    'private caller information',
  )
})

it('waits for an in-flight handoff and resumes only after its lease expires', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
  status = 'completed'
  attributes.conference_handoff = {
    conferenceSid: 'CFtest',
    delivered: false,
    leaseUntil: 160_000,
  }
  expect((await POST(request())).status).toBe(500)
  expect(mocks.updateCall).not.toHaveBeenCalled()
  now.mockReturnValue(160_001)
  expect((await POST(request())).status).toBe(200)
  expect(destination?.pathname).toBe('/api/taskrouter/retry-or-overflow')
  await POST(request())
  expect(mocks.updateCall).toHaveBeenCalledTimes(1)
})

it('does not immediately repeat a successful redirect if acknowledgement fails', async () => {
  const update = mocks.updateTask.getMockImplementation()!
  mocks.updateTask
    .mockImplementationOnce(update)
    .mockImplementationOnce(update)
    .mockRejectedValueOnce({ status: 503 })
  expect((await POST(request())).status).toBe(500)
  expect(destination?.pathname).toBe('/api/taskrouter/retry-or-overflow')
  expect((await POST(request())).status).toBe(500)
  expect(mocks.updateCall).toHaveBeenCalledTimes(1)
})
