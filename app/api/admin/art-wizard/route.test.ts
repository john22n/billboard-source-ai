import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/mockup/system-prompt', () => ({
  defaultSystemPrompt: 'You are the Billboard Source Mockup Wizard.',
  getSystemPrompt: mocks.read,
  saveSystemPrompt: mocks.save,
  resetSystemPrompt: mocks.reset,
}))

import { DELETE, GET, PUT } from './route'

const request = (body: unknown) =>
  new Request('http://localhost/api/admin/art-wizard', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'admin' })
  mocks.read.mockResolvedValue({ prompt: 'Custom wizard.', isDefault: false })
})

it.each([
  [null, 401],
  [{ userId: 'rep', role: 'user' }, 403],
])(
  'restricts reading, saving and resetting to admins',
  async (session, status) => {
    mocks.session.mockResolvedValue(session)
    expect((await GET()).status).toBe(status)
    expect((await PUT(request({ prompt: 'New instructions' }))).status).toBe(
      status,
    )
    expect((await DELETE()).status).toBe(status)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  },
)

it('loads the current prompt with the protected frames and saves validated instructions', async () => {
  const response = await GET()
  const data = await response.json()
  expect(data).toMatchObject({ prompt: 'Custom wizard.', isDefault: false })
  expect(
    data.instructions.map((item: { title: string }) => item.title),
  ).toEqual([
    'Tool instructions',
    'New image frame',
    'Revision frame',
    'PDF search',
    'Attachment handling',
  ])
  expect(
    data.instructions.every((item: { text: string }) => item.text.length > 0),
  ).toBe(true)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const saved = await PUT(
    request({ prompt: '  Ask five questions.\nKeep text bold.  ' }),
  )
  expect(saved.status).toBe(200)
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    'Ask five questions.\nKeep text bold.',
  )
  expect(await saved.json()).toEqual({
    prompt: 'Ask five questions.\nKeep text bold.',
    isDefault: false,
  })
})

it('resets to the original prompt in one request', async () => {
  const response = await DELETE()
  expect(response.status).toBe(200)
  expect(mocks.reset).toHaveBeenCalledTimes(1)
  expect(await response.json()).toEqual({
    prompt: 'You are the Billboard Source Mockup Wizard.',
    isDefault: true,
  })
})

it.each(['', '  \n ', 'x'.repeat(20001), 123, null])(
  'rejects invalid prompts before writing',
  async (prompt) => {
    expect((await PUT(request({ prompt }))).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  },
)

it('rejects malformed JSON and attempts to change protected instructions', async () => {
  const malformed = await PUT(
    new Request('http://localhost/api/admin/art-wizard', {
      method: 'PUT',
      body: '{',
    }),
  )
  expect(malformed.status).toBe(400)
  expect(
    (await PUT(request({ prompt: 'Valid style', instructions: [] }))).status,
  ).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
})

it('does not report success when storage fails', async () => {
  mocks.save.mockRejectedValue(new Error('database unavailable'))
  expect((await PUT(request({ prompt: 'New instructions' }))).status).toBe(500)
  mocks.reset.mockRejectedValue(new Error('database unavailable'))
  expect((await DELETE()).status).toBe(500)
  mocks.read.mockRejectedValue(new Error('database unavailable'))
  expect((await GET()).status).toBe(500)
})
