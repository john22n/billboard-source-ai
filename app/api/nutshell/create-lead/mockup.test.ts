import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getSession: async () => ({
    userId: 'rep',
    email: 'rep@example.test',
    sessionStartedAt: 123,
  }),
}))
vi.mock('@/lib/dal', () => ({ upsertNutshellLead: vi.fn() }))
vi.mock('@/lib/config', () => ({
  serverConfig: { nutshell: { requireApiKey: () => 'test-only' } },
  isMissingConfig: () => false,
  configErrorResponseBody: () => ({}),
}))
vi.mock('@/lib/mockup/receipts', () => ({ verifyImage: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
}))
import { POST as create } from './route'
import { POST as retry } from '../../mockup/leads/route'

const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  advertiser: 'Alpine Dental',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  receipt: 'signed',
}
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('returns successful lead creation on failed image upload; retry only attaches to that exact lead', async () => {
  const methods: string[] = []
  let uploads = 0
  let files: unknown[] = []
  const leadRecord = (leadId: number) => {
    expect(leadId).toBe(42)
    return {
      id: 42,
      rev: '1',
      primaryAccount: { name: 'Alpine Dental' },
      file: files,
    }
  }
  const rpc: Record<string, (params: { leadId: number }) => unknown> = {
    findUsers: () => [{ id: 1, emails: ['rep@example.test'] }],
    searchUniversal: () => ({ accounts: [{ id: 2, name: 'Alpine Dental' }] }),
    newContact: () => ({ id: 3 }),
    newSource: () => ({ id: 3 }),
    newLead: () => ({ id: 42 }),
    getLead: ({ leadId }) => leadRecord(leadId),
    editLead: ({ leadId }) => {
      files = [
        {
          id: 9,
          entityType: 'Files',
          name: `billboard-concept-${image.id}.jpg`,
          uri: 'https://app.nutshell.com/file/api/9',
          size: 0,
        },
      ]
      return leadRecord(leadId)
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).includes('/file/api/')) {
        uploads++
        return new Response('', { status: uploads === 1 ? 503 : 200 })
      }
      const { method, params } = JSON.parse(init.body)
      methods.push(method)
      return Response.json({ result: rpc[method]?.(params) ?? [] })
    }),
  )
  const response = await create(
    new NextRequest('http://localhost/api/nutshell/create-lead', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rep',
        entityName: 'Alpine Dental',
        phone: '3035550100',
        email: 'client@example.test',
        mockupImage: image,
      }),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    success: true,
    leadId: 42,
    imageAttachmentFailed: true,
    message: 'Lead created; image could not be attached',
  })
  const retried = await retry(
    new Request('http://localhost/api/mockup/leads', {
      method: 'POST',
      body: JSON.stringify({ leadId: 42, confirmedLeadId: 42, image }),
    }),
  )
  expect(retried.status).toBe(200)
  expect(methods.filter((method) => method === 'newLead')).toHaveLength(1)
  expect(methods.filter((method) => method === 'editLead')).toHaveLength(1)
  expect(uploads).toBe(2)
})

it('reports successful lead creation when the native image upload succeeds', async () => {
  const methods: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).includes('/file/api/'))
        return new Response('', { status: 200 })
      const { method, params } = JSON.parse(init.body)
      methods.push(method)
      const results: Record<string, unknown> = {
        findUsers: [{ id: 1, emails: ['rep@example.test'] }],
        searchUniversal: { accounts: [{ id: 2, name: 'Alpine Dental' }] },
        newContact: { id: 3 },
        newSource: { id: 3 },
        newLead: { id: 42 },
      }
      if (method === 'getLead' || method === 'editLead') {
        expect(params.leadId).toBe(42)
        return Response.json({
          result: {
            id: 42,
            rev: '1',
            primaryAccount: { name: 'Alpine Dental' },
            file:
              method === 'editLead'
                ? [
                    {
                      name: `billboard-concept-${image.id}.jpg`,
                      uri: 'https://app.nutshell.com/file/api/9',
                    },
                  ]
                : [],
          },
        })
      }
      return Response.json({ result: results[method] ?? [] })
    }),
  )
  const response = await create(
    new NextRequest('http://localhost/api/nutshell/create-lead', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Rep',
        entityName: 'Alpine Dental',
        phone: '3035550100',
        email: 'client@example.test',
        mockupImage: image,
      }),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    success: true,
    leadId: 42,
    imageAttachmentFailed: false,
    message: 'Lead created successfully in Nutshell',
  })
  expect(methods.filter((method) => method === 'newLead')).toHaveLength(1)
  expect(methods.filter((method) => method === 'editLead')).toHaveLength(1)
})
