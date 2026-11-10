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
    const tasks = Object.assign(
      () => ({
        fetch: async () => ({ ...task }),
        update: async ({ attributes }: { attributes: string }) => {
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
      callChannel: 'cell',
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
  })
})
