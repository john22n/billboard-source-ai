import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/dal', () => ({ getUserCellPhoneByEmail: mocks.user }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    app: {
      baseUrlFromRequest: () => 'https://app.example',
      addVercelBypassToken: vi.fn(),
    },
    taskRouter: { requireActivitySid: () => 'WAavailable' },
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
        workspaces: () => ({ tasks: () => ({ update: mocks.update }) }),
      },
    },
  }),
}))
import { POST } from './route'
import { POST as dial } from '../simultaneous-dial/route'

function request(
  worker: Record<string, unknown> = {},
  task: Record<string, unknown> = {},
) {
  return new Request('https://app.example/api/taskrouter/assignment', {
    method: 'POST',
    body: new URLSearchParams({
      TaskSid: 'WTtask',
      WorkspaceSid: 'WSworkspace',
      WorkerSid: 'WKrep',
      ReservationSid: 'WRreservation',
      WorkerAttributes: JSON.stringify({
        email: 'rep@example.com',
        contact_uri: 'client:custom-identity',
        ...worker,
      }),
      TaskAttributes: JSON.stringify({
        call_sid: 'CAcaller',
        from: '+12025550129',
        callType: 'direct',
        primary_owner: 'rep@example.com',
        ...task,
      }),
    }),
  })
}

describe('account-controlled simultaneous dialing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.user.mockResolvedValue('+13035550123')
    mocks.update.mockResolvedValue({})
  })

  it.each(['main', 'direct'])(
    'redirects %s offers to dial the saved cell and browser',
    async (callType) => {
      const result = await (
        await POST(
          request(
            { cell_phone: '+12025550199', simultaneous_ring: false },
            { callType },
          ),
        )
      ).json()
      expect(result).toMatchObject({
        instruction: 'redirect',
        call_sid: 'CAcaller',
        accept: true,
      })
      expect(mocks.user).toHaveBeenCalledWith('rep@example.com')
      const url = new URL(result.url)
      expect(url.pathname).toBe('/api/taskrouter/simultaneous-dial')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        taskSid: 'WTtask',
        workspaceSid: 'WSworkspace',
        clientIdentity: 'custom-identity',
        cellPhone: '+13035550123',
        callerFrom: '+12025550129',
        workerSid: 'WKrep',
        reservationSid: 'WRreservation',
      })
      const xml = await (
        await dial(new Request(url, { method: 'POST' }))
      ).text()
      expect(xml).toContain('<Identity>custom-identity</Identity>')
      expect(xml).toContain('method="POST">+13035550123</Number>')
      expect(xml).toContain('/api/taskrouter/cell-screen?')
      expect(xml).toContain('reservationSid=WRreservation')
    },
  )

  it('uses browser-only dialing without an account cell, ignoring stale worker flags', async () => {
    mocks.user.mockResolvedValue(null)
    const result = await (
      await POST(
        request({ simultaneous_ring: true, cell_phone: '+12025550199' }),
      )
    ).json()
    expect(result).toMatchObject({
      instruction: 'conference',
      to: 'client:custom-identity',
    })
  })

  it('preserves terminal overflow without looking up a user', async () => {
    const result = await (
      await POST(request({ email: 'voicemail@system' }))
    ).json()
    expect(new URL(result.url).pathname).toBe('/api/taskrouter/overflow')
    expect(Object.fromEntries(new URL(result.url).searchParams)).toEqual({
      taskSid: 'WTtask',
      workspaceSid: 'WSworkspace',
      callSid: 'CAcaller',
      callerFrom: '+12025550129',
    })
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it.each([
    ['voicemail@system', 'reject'],
    ['rep@example.com', 'conference'],
  ])(
    'handles missing call SID for %s without redirecting',
    async (email, instruction) => {
      const result = await (
        await POST(request({ email }, { call_sid: undefined }))
      ).json()
      expect(result.instruction).toBe(instruction)
      expect(result.url).toBeUndefined()
    },
  )

  it('rejects unsigned requests before database or Twilio access', async () => {
    mocks.valid.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
