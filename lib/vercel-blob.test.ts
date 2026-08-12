import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fetchVercelBlob, isVercelBlobUrl } from './vercel-blob'

describe('Vercel Blob URL validation', () => {
  it('allows only HTTPS public Vercel Blob hosts', () => {
    expect(
      isVercelBlobUrl(
        'https://store-id.public.blob.vercel-storage.com/import.csv',
      ),
    ).toBe(true)
    expect(isVercelBlobUrl('http://169.254.169.254/latest/meta-data')).toBe(
      false,
    )
    expect(
      isVercelBlobUrl(
        'https://store-id.public.blob.vercel-storage.com.attacker.test/file',
      ),
    ).toBe(false)
    expect(
      isVercelBlobUrl(
        'https://user@store-id.public.blob.vercel-storage.com/file',
      ),
    ).toBe(false)
  })

  it('rejects redirects when fetching an allowed URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'))
    const url = 'https://store-id.public.blob.vercel-storage.com/import.csv'

    await fetchVercelBlob(url)

    expect(fetchMock).toHaveBeenCalledWith(url, { redirect: 'error' })
    fetchMock.mockRestore()
  })
})
