import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  valid: true,
  status: 'wrapping',
  failUpdate: false,
}))

vi.mock('@/lib/twilio-webhook', () => ({
  isValidTwilioWebhook: async () => state.valid,
}))
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/lib/call-attempt-outcomes', () => ({
  recordAcceptedAttempt: vi.fn(),
  recordMissedAttempt: vi.fn(),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'ACtest',
        authToken: 'test',
      }),
    },
    taskRouter: { requireWorkspaceSid: () => 'WStest' },
  },
}))
vi.mock('twilio', () => ({
  default: () => ({
    taskrouter: {
      v1: {
        workspaces: () => ({
          tasks: () => ({
            fetch: async () => ({ assignmentStatus: state.status }),
            update: async ({
              assignmentStatus,
            }: {
              assignmentStatus: string
            }) => {
              if (state.failUpdate) throw new Error('Twilio unavailable')
              state.status = assignmentStatus
            },
          }),
        }),
      },
    },
  }),
}))

import { POST } from './route'

const request = () =>
  new Request('https://app.example/api/taskrouter/events', {
    method: 'POST',
    body: new URLSearchParams({ EventType: 'task.wrapup', TaskSid: 'WTtest' }),
  })

describe('TaskRouter wrap-up completion', () => {
  beforeEach(() => {
    state.valid = true
    state.status = 'wrapping'
    state.failUpdate = false
  })

  it('completes wrap-up so the voice slot is released, including duplicate delivery', async () => {
    expect((await POST(request())).status).toBe(204)
    expect(state.status).toBe('completed')
    // A redelivery must not try to complete the already completed task again.
    state.failUpdate = true
    expect((await POST(request())).status).toBe(204)
    expect(state.status).toBe('completed')
  })

  it('does not complete a task that is still assigned', async () => {
    state.status = 'assigned'
    expect((await POST(request())).status).toBe(204)
    expect(state.status).toBe('assigned')
  })

  it('reports a cleanup failure instead of acknowledging success', async () => {
    state.failUpdate = true
    expect((await POST(request())).status).toBe(500)
    expect(state.status).toBe('wrapping')
  })

  it('rejects unsigned wrap-up events without changing the task', async () => {
    state.valid = false
    expect((await POST(request())).status).toBe(403)
    expect(state.status).toBe('wrapping')
  })
})
