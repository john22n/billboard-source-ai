import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/mockup/image-prompt', () => ({
  getImageGenerationPrompt: mocks.read,
  saveImageGenerationPrompt: mocks.save,
}))

import { GET, PUT } from './route'

const request = (body: unknown) =>
  new Request('http://localhost/api/admin/art-wizard', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'admin' })
  mocks.read.mockResolvedValue('Create a high contrast billboard.')
})

it.each([
  [null, 401],
  [{ userId: 'rep', role: 'user' }, 403],
])('restricts reading and saving to admins', async (session, status) => {
  mocks.session.mockResolvedValue(session)
  expect((await GET()).status).toBe(status)
  expect((await PUT(request({ prompt: 'New instructions' }))).status).toBe(
    status,
  )
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})

it('loads the current prompt without caching and saves validated instructions', async () => {
  const response = await GET()
  const data = await response.json()
  expect(data).toMatchObject({
    prompt: 'Create a high contrast billboard.',
  })
  expect(
    data.instructions.map((item: { title: string }) => item.title),
  ).toEqual([
    'Questionnaire extraction',
    'Approval summary',
    'Summary reference guidance',
    'New image assembly',
    'Image revisions',
    'PDF search',
    'Attachment handling',
    'Questionnaire questions',
  ])
  expect(
    data.instructions.every((item: { text: string }) => item.text.length > 0),
  ).toBe(true)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const saved = await PUT(
    request({ prompt: '  Use watercolor.\nKeep text bold.  ' }),
  )
  expect(saved.status).toBe(200)
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    'Use watercolor.\nKeep text bold.',
  )
  expect(await saved.json()).toEqual({
    prompt: 'Use watercolor.\nKeep text bold.',
  })
})

it.each(['', '  \n ', 'x'.repeat(20001), 123, null])(
  'rejects invalid prompts before writing',
  async (prompt) => {
    expect((await PUT(request({ prompt }))).status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  },
)

it('rejects malformed JSON', async () => {
  const response = await PUT(
    new Request('http://localhost/api/admin/art-wizard', {
      method: 'PUT',
      body: '{',
    }),
  )
  expect(response.status).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
})

it('rejects attempts to change protected instructions', async () => {
  expect(
    (await PUT(request({ prompt: 'Valid style', instructions: [] }))).status,
  ).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
})

it('does not report success when storage fails', async () => {
  mocks.save.mockRejectedValue(new Error('database unavailable'))
  expect((await PUT(request({ prompt: 'New instructions' }))).status).toBe(500)
  mocks.read.mockRejectedValue(new Error('database unavailable'))
  expect((await GET()).status).toBe(500)
})
