import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ signedIn: true, allowed: true }))
vi.mock('@/lib/auth', () => ({
  getSession: async () => (auth.signedIn ? { userId: 'rep' } : null),
}))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test' } },
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: auth.allowed }),
}))
import { POST } from './route'

const fetcher = vi.fn<typeof fetch>()
const pages = [1, 2, 3].map((pageNumber) => ({
  pageNumber,
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
}))
const request = (body: unknown = { query: 'company logo', pages }) =>
  new Request('http://localhost/api/mockup/search-pdf', {
    method: 'POST',
    body: JSON.stringify(body),
  })
function providerResult(pageNumber: number | null) {
  return Response.json({
    id: 'resp_pdf',
    created_at: 1790112545,
    model: 'gpt-5.4-mini',
    output: [
      {
        id: 'msg_pdf',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              pageNumber,
              reason: pageNumber
                ? 'Logo is on this page.'
                : 'No matching image found.',
            }),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  })
}
beforeEach(() => {
  auth.signedIn = auth.allowed = true
  fetcher.mockReset().mockResolvedValue(providerResult(3))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

it('searches all pages and returns a matching page beyond the first', async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    pageNumber: 3,
    reason: 'Logo is on this page.',
  })
  const input = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).input
  const content = input.flatMap(
    (message: { content: unknown }) => message.content,
  )
  expect(
    content.filter((part: { type: string }) => part.type === 'input_image'),
  ).toHaveLength(3)
  expect(JSON.stringify(input)).toContain('PDF page 3 of 3')
  expect(JSON.stringify(input)).toContain('company logo')
})
it('can select the last page at the 50-page boundary', async () => {
  fetcher.mockResolvedValueOnce(providerResult(50))
  const response = await POST(
    request({
      query: 'background',
      pages: Array.from({ length: 50 }, (_, index) => ({
        ...pages[0],
        pageNumber: index + 1,
      })),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ pageNumber: 50 })
})
it('reports no match rather than selecting page one', async () => {
  fetcher.mockResolvedValueOnce(providerResult(null))
  const response = await POST(request())
  expect(await response.json()).toEqual({
    pageNumber: null,
    reason: 'No matching image found.',
  })
})
it('rejects an invented page number returned by the provider', async () => {
  fetcher.mockResolvedValueOnce(providerResult(4))
  expect((await POST(request())).status).toBe(502)
})
it.each([
  { query: 'logo', pages: [] },
  { query: 'logo', pages: [pages[1]] },
  { query: 'logo', pages: [pages[0], pages[0]] },
  {
    query: 'logo',
    pages: Array.from({ length: 51 }, (_, index) => ({
      ...pages[0],
      pageNumber: index + 1,
    })),
  },
  {
    query: 'logo',
    pages: [{ pageNumber: 1, dataUrl: 'https://internal.example/image.png' }],
  },
  { query: '', pages },
])('rejects invalid or incomplete search requests (case %#)', async (body) => {
  expect((await POST(request(body))).status).toBe(400)
  expect(fetcher).not.toHaveBeenCalled()
})
it('requires authentication and rate limits provider calls', async () => {
  auth.signedIn = false
  expect((await POST(request())).status).toBe(401)
  auth.signedIn = true
  auth.allowed = false
  expect((await POST(request())).status).toBe(429)
  expect(fetcher).not.toHaveBeenCalled()
})
