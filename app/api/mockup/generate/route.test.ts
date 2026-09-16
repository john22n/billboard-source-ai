import { beforeEach, expect, it, vi } from 'vitest'
import { freshIntake } from '@/lib/mockup/intake'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/lib/mockup/quota', () => ({
  reserveImage: mocks.reserve,
  settleImage: mocks.settle,
}))
vi.mock('@/lib/mockup/receipts', () => ({
  signArtifact: async () => 'signed',
  verifyArtifact: vi.fn(),
  verifyImage: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    images = { generate: mocks.generate, edit: mocks.edit }
  },
  toFile: async (bytes: Buffer) => bytes,
}))
import { POST } from './route'
const brief = {
  intake: { ...freshIntake(), advertiser: 'Alpine' },
  summary: {
    headline: 'Smile bigger',
    supporting: '',
    contact: '',
    direction: 'Bold',
    caution: '',
  },
  approved: true,
}
const request = (body: unknown) =>
  new Request('http://localhost/api/mockup/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.reserve.mockResolvedValue({ token: 'slot', remaining: 9 })
  mocks.settle.mockResolvedValue(undefined)
})

it('does not reserve or call OpenAI before explicit initial approval', async () => {
  expect((await POST(request({ ...brief, approved: false }))).status).toBe(400)
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('uses the selected image as the revision reference and refunds a failed request', async () => {
  mocks.edit.mockRejectedValueOnce(new Error('Provider failure'))
  const previous = {
    id: '12345678-1234-4123-8123-123456789abc',
    advertiser: 'Alpine',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    receipt: 'signed',
  }
  const response = await POST(
    request({ ...brief, previous, revision: 'Bigger text', approved: false }),
  )
  expect(response.status).toBe(502)
  expect(mocks.edit.mock.calls[0][0].image[0]).toEqual(
    Buffer.from('/9j/2Q==', 'base64'),
  )
  expect(mocks.edit.mock.calls[0][0].prompt).toContain('Bigger text')
  expect(mocks.edit.mock.calls[0][0].prompt).not.toContain('Smile bigger')
  expect(mocks.edit.mock.calls[0][0].image).toHaveLength(1)
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.settle).toHaveBeenCalledWith('rep', 'slot', false)
})
it('counts exactly one successful image and returns a signed, session-only image', async () => {
  mocks.generate.mockResolvedValueOnce({ data: [{ b64_json: '/9j/2Q==' }] })
  const response = await POST(request(brief))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    image: {
      advertiser: 'Alpine',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      receipt: 'signed',
    },
    remaining: 9,
  })
  expect(mocks.generate.mock.calls[0][0].n).toBe(1)
  expect(mocks.settle).toHaveBeenCalledWith('rep', 'slot', true)
})
