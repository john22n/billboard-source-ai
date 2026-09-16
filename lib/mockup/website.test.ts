import { describe, expect, it } from 'vitest'
import { publicAddress, fetchPublicWebsite, reviewWebsite } from './website'

describe('website isolation', () => {
  it('blocks local, metadata, multicast and IPv4-mapped private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(publicAddress(address)).toBe(false)
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('rejects non-HTTPS schemes and credentials before making a request', async () => {
    await expect(fetchPublicWebsite('http://example.com')).rejects.toThrow(
      'HTTPS',
    )
    await expect(
      fetchPublicWebsite('https://user:secret@example.com'),
    ).rejects.toThrow('HTTPS')
    expect(await reviewWebsite('')).toMatchObject({
      logo: null,
      fallback: expect.stringContaining('name will appear as text'),
    })
  })
})
