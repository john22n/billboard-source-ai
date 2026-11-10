import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, twilioClient, selectUsers, configEnv, task } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    twilioClient: vi.fn(),
    selectUsers: vi.fn(),
    configEnv: {
      TWILIO_ACCOUNT_SID: 'AC-test',
      TWILIO_AUTH_TOKEN: 'test-token',
      TASKROUTER_WORKSPACE_SID: 'WS-test',
      TASKROUTER_ACTIVITY_AVAILABLE_SID: 'WA-available',
      TASKROUTER_ACTIVITY_BUSY_SID: undefined as string | undefined,
    },
    task: {
      sid: 'WT-call',
      assignmentStatus: 'assigned',
      attributes: '',
    },
  }),
)

vi.mock('@/lib/auth', () => ({ getSessionWithoutRefresh: getSession }))
vi.mock('@/db', () => ({
  db: { select: () => ({ from: selectUsers }) },
}))
vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: () => true }))
vi.mock('twilio', () => ({ default: twilioClient }))
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    serverConfig: actual.createServerConfig(configEnv),
  }
})

import { GET } from './route'
import { POST as acceptCell } from '../../taskrouter/cell-screen-accept/route'
import { POST as legStatus } from '../../taskrouter/client-status/route'

describe('GET /api/workers/available without Busy activity configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configEnv.TASKROUTER_ACTIVITY_BUSY_SID = undefined
    vi.stubEnv('NODE_ENV', 'development')
    getSession.mockResolvedValue({ userId: 'rep-1' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns an empty uncached roster without logging on repeated local polls', async () => {
    for (let poll = 0; poll < 2; poll++) {
      const response = await GET()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({ workers: [] })
    }
    expect(console.error).not.toHaveBeenCalled()
    expect(twilioClient).not.toHaveBeenCalled()
  })

  it('keeps missing configuration visible in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'Worker availability is unavailable',
    })
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('TASKROUTER_ACTIVITY_BUSY_SID'),
    )
  })

  it('still requires authentication locally', async () => {
    getSession.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('does not silence unrelated local failures', async () => {
    const failure = new Error('Session lookup failed')
    getSession.mockRejectedValue(failure)
    const response = await GET()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal error' })
    expect(console.error).toHaveBeenCalledWith(expect.any(String), failure)
  })
})

describe('call status shared by the cell and site', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows ringing, cell acceptance, and completion without exposing another rep’s caller', async () => {
    vi.useFakeTimers()
    configEnv.TASKROUTER_ACTIVITY_BUSY_SID = 'WA-busy'
    getSession.mockResolvedValue({
      userId: 'rep-1',
      taskRouterWorkerSid: 'WK-rep',
    })
    selectUsers.mockResolvedValue([
      { email: 'rep@example.test', taskRouterWorkerSid: 'WK-rep' },
      { email: 'next@example.test', taskRouterWorkerSid: 'WK-next' },
    ])
    task.assignmentStatus = 'assigned'
    task.attributes = JSON.stringify({
      call_sid: 'CA-parent',
      from: '+13035550123',
      call_offer: {
        workerSid: 'WK-rep',
        reservationSid: 'WR-offer',
        status: 'ringing',
        channel: null,
      },
    })
    let failFetch = true
    let failUpdate = true
    const tasks = Object.assign(
      () => ({
        fetch: async () => {
          if (failFetch) {
            failFetch = false
            throw Object.assign(new Error('Temporary TaskRouter outage'), {
              status: 503,
            })
          }
          return { ...task }
        },
        update: async ({ attributes }: { attributes: string }) => {
          if (failUpdate) {
            failUpdate = false
            throw Object.assign(new Error('Temporary TaskRouter outage'), {
              status: 503,
            })
          }
          task.attributes = attributes
          return { ...task }
        },
      }),
      {
        list: async () =>
          task.assignmentStatus === 'assigned' ? [{ ...task }] : [],
      },
    )
    twilioClient.mockReturnValue({
      taskrouter: {
        v1: {
          workspaces: () => ({
            tasks,
            workers: {
              list: async () => [
                {
                  sid: 'WK-rep',
                  friendlyName: 'rep@example.test',
                  attributes: '{}',
                  activitySid: 'WA-available',
                  activityName: 'Available',
                  dateStatusChanged: new Date('2026-11-10T12:00:00Z'),
                },
                {
                  sid: 'WK-next',
                  friendlyName: 'next@example.test',
                  attributes: '{}',
                  activitySid: 'WA-available',
                  activityName: 'Available',
                  dateStatusChanged: new Date('2026-11-10T12:01:00Z'),
                },
              ],
            },
          }),
        },
      },
    })

    const ringing = await (await GET()).json()
    expect(ringing.workers).toEqual([
      { id: 'WK-next', name: 'Next', status: 'available' },
      { id: 'WK-rep', name: 'Rep', status: 'ringing' },
    ])
    expect(ringing.currentCall).toEqual({
      taskSid: 'WT-call',
      callSid: 'CA-parent',
      callerFrom: '+13035550123',
      status: 'ringing',
      channel: null,
    })

    getSession.mockResolvedValue({
      userId: 'rep-2',
      taskRouterWorkerSid: 'WK-next',
    })
    const observerRinging = await (await GET()).json()
    expect(observerRinging.workers).toContainEqual({
      id: 'WK-rep',
      name: 'Rep',
      status: 'ringing',
    })
    expect(observerRinging.currentCall).toBeNull()
    expect(JSON.stringify(observerRinging)).not.toContain('+13035550123')
    getSession.mockResolvedValue({
      userId: 'rep-1',
      taskRouterWorkerSid: 'WK-rep',
    })

    const callback = (
      route: string,
      parameters: Record<string, string>,
      query = '',
    ) =>
      new Request(
        `https://app.example/api/taskrouter/${route}?taskSid=WT-call&workspaceSid=WS-test&workerSid=WK-rep&reservationSid=WR-offer${query}`,
        {
          method: 'POST',
          body: new URLSearchParams({
            CallSid: 'CA-child',
            ParentCallSid: 'CA-parent',
            ...parameters,
          }),
        },
      )

    // Carrier answer and the wrong screening digit must both remain ringing.
    expect(
      (
        await legStatus(
          callback('client-status', { CallStatus: 'in-progress' }, '&leg=cell'),
        )
      ).status,
    ).toBe(204)
    expect(
      await (
        await acceptCell(callback('cell-screen-accept', { Digits: '2' }))
      ).text(),
    ).toContain('<Hangup/>')
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await (await GET()).json()).currentCall.status).toBe('ringing')

    // Acceptance must survive transient failures reading and writing the offer.
    const response = await acceptCell(
      new Request(
        'https://app.example/api/taskrouter/cell-screen-accept?taskSid=WT-call&workspaceSid=WS-test&workerSid=WK-rep',
        {
          method: 'POST',
          body: new URLSearchParams({
            Digits: '1',
            CallSid: 'CA-cell',
            ParentCallSid: 'CA-parent',
          }),
        },
      ),
    )
    expect(await response.text()).toContain('<Response></Response>')
    await vi.advanceTimersByTimeAsync(5_000)
    const answered = await (await GET()).json()
    expect(answered.workers).toContainEqual({
      id: 'WK-rep',
      name: 'Rep',
      status: 'busy',
    })
    expect(answered.currentCall).toMatchObject({
      status: 'answered',
      channel: 'cell',
      callerFrom: '+13035550123',
    })

    getSession.mockResolvedValue({
      userId: 'rep-2',
      taskRouterWorkerSid: 'WK-next',
    })
    const otherRep = await (await GET()).json()
    expect(otherRep.currentCall).toBeNull()
    expect(JSON.stringify(otherRep)).not.toContain('+13035550123')

    task.assignmentStatus = 'completed'
    await vi.advanceTimersByTimeAsync(5_000)
    getSession.mockResolvedValue({
      userId: 'rep-1',
      taskRouterWorkerSid: 'WK-rep',
    })
    const completed = await (await GET()).json()
    expect(completed.currentCall).toBeNull()
    expect(completed.workers[0]).toEqual({
      id: 'WK-rep',
      name: 'Rep',
      status: 'available',
    })

    // Late callbacks cannot resurrect a completed offer.
    await acceptCell(callback('cell-screen-accept', { Digits: '1' }))
    await legStatus(
      callback('client-status', { CallStatus: 'in-progress' }, '&leg=browser'),
    )
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await (await GET()).json()).currentCall).toBeNull()

    // A subsequent browser-answered call must not inherit the old cell state.
    task.assignmentStatus = 'assigned'
    task.attributes = JSON.stringify({
      call_sid: 'CA-next-parent',
      from: '+13035550987',
      call_offer: {
        workerSid: 'WK-rep',
        reservationSid: 'WR-next',
        status: 'ringing',
        channel: null,
      },
    })
    await acceptCell(callback('cell-screen-accept', { Digits: '1' }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await (await GET()).json()).currentCall.status).toBe('ringing')

    const browserResponse = await legStatus(
      new Request(
        'https://app.example/api/taskrouter/client-status?taskSid=WT-call&workspaceSid=WS-test&workerSid=WK-rep&reservationSid=WR-next&leg=browser',
        {
          method: 'POST',
          body: new URLSearchParams({
            CallStatus: 'in-progress',
            CallSid: 'CA-browser',
            ParentCallSid: 'CA-next-parent',
          }),
        },
      ),
    )
    expect(browserResponse.status).toBe(204)
    await vi.advanceTimersByTimeAsync(2_000)
    const browserAnswered = await (await GET()).json()
    expect(browserAnswered.currentCall).toMatchObject({
      status: 'answered',
      channel: 'browser',
      callerFrom: '+13035550987',
    })
    expect(browserAnswered.workers).toContainEqual({
      id: 'WK-rep',
      name: 'Rep',
      status: 'busy',
    })
  })
})
