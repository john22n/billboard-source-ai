import { afterEach, expect, it, vi } from 'vitest'
import { nutshellRequest } from './nutshell'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('sends an authenticated, bounded JSON-RPC request without following redirects or caching', async () => {
  const signal = new AbortController().signal
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal)
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ result: { id: 42 } }))
  vi.stubGlobal('fetch', fetcher)

  await expect(
    nutshellRequest('getLead', { leadId: 42 }, 'credentials'),
  ).resolves.toEqual({ result: { id: 42 } })

  expect(timeout).toHaveBeenCalledWith(20_000)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://app.nutshell.com/api/v1/json',
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic credentials',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: expect.any(String),
      signal,
      cache: 'no-store',
      redirect: 'error',
    },
  )
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    jsonrpc: '2.0',
    id: expect.any(String),
    method: 'getLead',
    params: { leadId: 42 },
  })
})

it('rejects an HTTP failure even with a success-shaped body, without retrying the write', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ result: { id: 42 } }, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(
    nutshellRequest('newLead', { lead: {} }, 'credentials'),
  ).rejects.toThrow('Nutshell request failed (HTTP 503).')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('returns RPC errors intact for caller-specific fallbacks and messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        error: {
          code: -32602,
          message: 'Invalid lead',
          data: { field: 'name' },
        },
      }),
    ),
  )
  await expect(
    nutshellRequest('newLead', { lead: {} }, 'credentials'),
  ).resolves.toEqual({
    error: { code: -32602, message: 'Invalid lead', data: { field: 'name' } },
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('propagates network failures without retrying a potentially completed write', async () => {
  const error = new TypeError('Connection closed')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  await expect(
    nutshellRequest('newLead', { lead: {} }, 'credentials'),
  ).rejects.toBe(error)
  expect(fetch).toHaveBeenCalledTimes(1)
})
