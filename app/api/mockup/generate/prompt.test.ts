import { beforeEach, expect, it, vi } from 'vitest'
import { freshIntake } from '@/lib/mockup/intake'

const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  generate: vi.fn(),
  edit: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: 'rep', sessionStartedAt: 123 }),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/lib/mockup/image-prompt', () => ({
  getImageGenerationPrompt: mocks.prompt,
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
  vi.resetAllMocks()
  mocks.prompt.mockResolvedValue('Use a hand-painted watercolor style.')
  mocks.generate.mockResolvedValue({ data: [{ b64_json: '/9j/2Q==' }] })
  mocks.edit.mockResolvedValue({ data: [{ b64_json: '/9j/2Q==' }] })
})

it('uses the saved prompt for a new image while retaining the approved brief and logo rules', async () => {
  expect((await POST(request(brief))).status).toBe(200)
  const prompt = mocks.generate.mock.calls[0][0].prompt
  expect(prompt).toContain('Use a hand-painted watercolor style.')
  expect(prompt).toContain('"headline":"Smile bigger"')
  expect(prompt).toContain('"advertiser":"Alpine"')
  expect(prompt).toContain('Do NOT invent a logo.')
  expect(prompt).not.toContain('Create ONE finished professional')
})

it('uses the saved instructions when generating with a supplied logo', async () => {
  const response = await POST(
    request({
      ...brief,
      logo: 'data:image/png;base64,aGVsbG8=',
      logoReceipt: 'signed',
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.edit.mock.calls[0][0].prompt).toContain(
    'Use a hand-painted watercolor style.',
  )
  expect(mocks.edit.mock.calls[0][0].prompt).toContain(
    'Use the supplied website logo faithfully.',
  )
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('leaves revisions independent of the configurable initial-generation prompt', async () => {
  mocks.prompt.mockRejectedValue(new Error('Settings storage unavailable'))
  const response = await POST(
    request({
      ...brief,
      previous: {
        id: '12345678-1234-4123-8123-123456789abc',
        advertiser: 'Alpine',
        dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        receipt: 'signed',
      },
      revision: 'Remove the phone number',
      approved: false,
    }),
  )
  expect(response.status).toBe(200)
  expect(mocks.prompt).not.toHaveBeenCalled()
  expect(mocks.edit.mock.calls[0][0].prompt).toContain(
    'Remove the phone number',
  )
  expect(mocks.edit.mock.calls[0][0].prompt).not.toContain('Smile bigger')
})

it('does not silently generate with stale defaults when settings storage fails', async () => {
  mocks.prompt.mockRejectedValue(new Error('Settings storage unavailable'))
  expect((await POST(request(brief))).status).toBe(502)
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(mocks.edit).not.toHaveBeenCalled()
})
