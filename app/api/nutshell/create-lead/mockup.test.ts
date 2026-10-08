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
  serverConfig: {
    nutshell: { requireApiKey: () => 'test-only' },
    auth: { jwtSecret: 'test-secret-that-is-long-enough-for-hs256-signing' },
  },
  isMissingConfig: () => false,
  configErrorResponseBody: () => ({}),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true }),
}))
import { POST as create } from './route'
import { POST as retry } from '../../mockup/leads/route'
import { signArtifact } from '@/lib/mockup/receipts'

const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  advertiser: 'Alpine Dental',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  receipt: 'signed',
}
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  image.receipt = await signArtifact(
    { userId: 'rep', sessionStartedAt: 123 },
    'image',
    image.dataUrl,
    image.advertiser,
    image.id,
  )
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
  const created = await response.json()
  expect(created).toMatchObject({
    success: true,
    leadId: 42,
    imageAttachmentFailed: true,
    imageAttachmentReceipt: expect.any(String),
    message: 'Lead created; image could not be attached',
  })
  const request = (leadId: number, receipt = created.imageAttachmentReceipt) =>
    new Request('http://localhost/api/mockup/leads', {
      method: 'POST',
      body: JSON.stringify({
        leadId,
        confirmedLeadId: leadId,
        receipt,
        image,
      }),
    })
  const callsBeforeRetry = vi.mocked(fetch).mock.calls.length
  expect((await retry(request(73))).status).toBe(400)
  expect((await retry(request(42, ''))).status).toBe(400)
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeRetry)
  const retried = await retry(request(42))
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

it.each(['bulletin', 'poster'])(
  'retains both file reservations when the %s upload fails and retries only that file',
  async (failedFormat) => {
    const poster = {
      ...image,
      id: '22222222-2222-4222-8222-222222222222',
      sourceId: image.id,
    }
    poster.receipt = await signArtifact(
      { userId: 'rep', sessionStartedAt: 123 },
      'image',
      poster.dataUrl,
      poster.advertiser,
      `${poster.id}:${image.id}`,
    )
    type FileRecord = { name: string; uri?: string; size?: number }
    let files: FileRecord[] = [{ name: 'existing-contract.pdf', size: 20 }]
    const uploaded: string[] = []
    const methods: string[] = []
    const selected = failedFormat === 'poster' ? poster : image
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (String(url).includes('/file/api/')) {
          const file = (init.body as FormData).get('file') as File
          uploaded.push(file.name)
          const shouldFail = file.name.includes(selected.id) && fail
          if (!shouldFail)
            files.find((item) => item.name === file.name)!.size = file.size
          return new Response('', { status: shouldFail ? 503 : 200 })
        }
        const { method, params } = JSON.parse(init.body)
        methods.push(method)
        if (method === 'editLead')
          files = params.lead.file.map((file: FileRecord, index: number) => ({
            ...file,
            uri: file.uri ?? `https://app.nutshell.com/file/api/${index + 1}`,
          }))
        if (method === 'getLead' || method === 'editLead')
          return Response.json({
            result: {
              id: 42,
              rev: String(files.length),
              primaryAccountName: 'Alpine Dental',
              file: files,
            },
          })
        const results: Record<string, unknown> = {
          findUsers: [{ id: 1, emails: ['rep@example.test'] }],
          searchUniversal: { accounts: [{ id: 2, name: 'Alpine Dental' }] },
          newContact: { id: 3 },
          newSource: { id: 3 },
          newLead: { id: 42 },
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
          mockupPoster: poster,
        }),
      }),
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(uploaded).toHaveLength(2)
    expect(result.imageAttachmentFailed).toBe(failedFormat === 'bulletin')
    expect(result.posterAttachmentFailed).toBe(failedFormat === 'poster')
    expect(files).toHaveLength(3)
    expect(files[0]).toMatchObject({ name: 'existing-contract.pdf', size: 20 })
    fail = false
    const retried = await retry(
      new Request('http://localhost/api/mockup/leads', {
        method: 'POST',
        body: JSON.stringify({
          leadId: 42,
          confirmedLeadId: 42,
          image: selected,
          receipt:
            failedFormat === 'poster'
              ? result.posterAttachmentReceipt
              : result.imageAttachmentReceipt,
        }),
      }),
    )
    expect(retried.status).toBe(200)
    expect(uploaded).toHaveLength(3)
    expect(uploaded[2]).toContain(selected.id)
    expect(methods.filter((method) => method === 'newLead')).toHaveLength(1)
    expect(methods.filter((method) => method === 'editLead')).toHaveLength(2)
  },
)
