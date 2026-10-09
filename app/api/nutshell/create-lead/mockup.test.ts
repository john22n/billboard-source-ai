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

it('uploads both formats; a failed poster retries only that file on the original lead', async () => {
  const pair = { ...image, posterDataUrl: 'data:image/jpeg;base64,/9j/AA==' }
  pair.receipt = await signArtifact(
    { userId: 'rep', sessionStartedAt: 123 },
    'image',
    JSON.stringify([pair.dataUrl, pair.posterDataUrl]),
    pair.advertiser,
    pair.id,
  )
  const bulletinName = `billboard-bulletin-${image.id}.jpg`
  const posterName = `billboard-poster-${image.id}.jpg`
  const methods: string[] = []
  const uploads: string[] = []
  let files = [
    {
      name: 'existing-contract.pdf',
      size: 120,
      uri: 'https://app.nutshell.com/file/api/8',
    },
  ]
  const leadRecord = (leadId: number) => {
    expect(leadId).toBe(42)
    return {
      id: 42,
      rev: '1',
      primaryAccount: { name: 'Alpine Dental' },
      file: files,
    }
  }
  const rpc: Record<
    string,
    (params: { leadId: number; lead: { file: typeof files } }) => unknown
  > = {
    findUsers: () => [{ id: 1, emails: ['rep@example.test'] }],
    searchUniversal: () => ({ accounts: [{ id: 2, name: 'Alpine Dental' }] }),
    newContact: () => ({ id: 3 }),
    newSource: () => ({ id: 3 }),
    newLead: () => ({ id: 42 }),
    getLead: ({ leadId }) => leadRecord(leadId),
    editLead: ({ leadId, lead }) => {
      files = lead.file.map((file, index) => ({
        ...file,
        size: file.size || 0,
        uri: file.uri || `https://app.nutshell.com/file/api/${9 + index}`,
      }))
      return leadRecord(leadId)
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).includes('/file/api/')) {
        const file = init.body.get('file') as File
        uploads.push(file.name)
        expect(file.type).toBe('image/jpeg')
        const expected = file.name === bulletinName ? '/9j/2Q==' : '/9j/AA=='
        expect(Buffer.from(await file.arrayBuffer()).toString('base64')).toBe(
          expected,
        )
        if (uploads.length === 2) return new Response('', { status: 503 })
        files.find((saved) => saved.name === file.name)!.size = file.size
        return new Response('', { status: 200 })
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
        mockupImage: pair,
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
    message: 'Lead created; one or more images could not be attached',
  })
  const request = (
    leadId: number,
    receipt = created.imageAttachmentReceipt,
    selected: typeof image & { posterDataUrl?: string } = pair,
  ) =>
    new Request('http://localhost/api/mockup/leads', {
      method: 'POST',
      body: JSON.stringify({
        leadId,
        confirmedLeadId: leadId,
        receipt,
        image: selected,
      }),
    })
  const callsBeforeRetry = vi.mocked(fetch).mock.calls.length
  expect((await retry(request(73))).status).toBe(400)
  expect((await retry(request(42, ''))).status).toBe(400)
  // Even a valid independently signed image cannot replace the submitted pair.
  expect(
    (
      await retry(
        request(42, created.imageAttachmentReceipt, {
          ...image,
          posterDataUrl: undefined,
        }),
      )
    ).status,
  ).toBe(400)
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeRetry)
  const retried = await retry(request(42))
  expect(retried.status).toBe(200)
  expect(methods.filter((method) => method === 'newLead')).toHaveLength(1)
  expect(uploads).toEqual([bulletinName, posterName, posterName])
  expect(files.map((file) => file.name)).toEqual([
    'existing-contract.pdf',
    bulletinName,
    posterName,
  ])
  expect(files.every((file) => file.size > 0)).toBe(true)
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
