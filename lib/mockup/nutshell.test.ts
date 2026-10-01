import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachMockup, searchMockupLeads } from './nutshell'

const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  advertiser: 'Alpine Dental',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  receipt: 'signed',
}
const existing = {
  entityType: 'Files',
  id: 7,
  name: 'existing-contract.pdf',
  size: 120,
}
const reserved = {
  entityType: 'Files',
  id: 8,
  name: `billboard-concept-${image.id}.jpg`,
  size: 0,
  uri: 'https://app.nutshell.com/file/api/8',
}
const lead = {
  id: 42,
  rev: 'r1',
  primaryAccount: { name: 'Alpine Dental' },
  name: 'Spring campaign',
  file: [existing],
}
const rpc = (result: unknown) => Response.json({ result })
afterEach(() => vi.unstubAllGlobals())

describe('native Nutshell image delivery', () => {
  it('finds company-associated leads even when their names do not match, and deduplicates results', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(rpc({ accounts: [{ id: 15 }], leads: [lead] }))
      .mockResolvedValueOnce(
        rpc([
          { ...lead, creator: { emails: ['rep@example.test'] } },
          {
            ...lead,
            id: 43,
            name: 'Summer campaign',
            creator: { emails: ['rep@example.test'] },
          },
        ]),
      )
    vi.stubGlobal('fetch', fetcher)
    const results = await searchMockupLeads(
      'Alpine Dental',
      'credentials',
      'rep@example.test',
    )
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      method: 'findLeads',
      params: { query: { accountId: 15 }, stubResponses: false },
    })
    expect(results.map((result) => result.id)).toEqual([42, 43])
  })
  it('matches creator or assignee email and excludes leads matching neither', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const { method, params } = JSON.parse(init.body)
      if (method === 'searchUniversal')
        return rpc({ leads: [42, 43, 44, 45, 46].map((id) => ({ id })) })
      expect(method).toBe('getLead')
      const creators: Record<number, unknown> = {
        42: { emails: ['alias@example.test', ' REP@EXAMPLE.TEST '] },
        43: { emails: ['other@example.test'] },
        44: null,
        45: { emails: ['other@example.test'] },
        46: null,
      }
      return rpc({
        ...lead,
        id: params.leadId,
        creator: creators[params.leadId],
        assignee: {
          emails: [
            [43, 44].includes(params.leadId)
              ? ' REP@EXAMPLE.TEST '
              : 'other@example.test',
          ],
        },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    expect(
      await searchMockupLeads('Alpine', 'credentials', 'rep@example.test'),
    ).toEqual([
      { id: 42, name: 'Spring campaign', advertiser: 'Alpine Dental' },
      { id: 43, name: 'Spring campaign', advertiser: 'Alpine Dental' },
      { id: 44, name: 'Spring campaign', advertiser: 'Alpine Dental' },
    ])
  })
  it('preserves existing files and retries the same file reservation without creating a lead', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(rpc(lead))
      .mockResolvedValueOnce(rpc({ ...lead, file: [existing, reserved] }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(rpc({ ...lead, file: [existing, reserved] }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(attachMockup(42, image, 'credentials')).rejects.toThrow(
      'upload failed',
    )
    expect(
      JSON.parse(fetcher.mock.calls[1][1].body).params.lead.file[0],
    ).toEqual(existing)
    await expect(attachMockup(42, image, 'credentials')).resolves.toMatchObject(
      { id: 42 },
    )
    expect(
      fetcher.mock.calls.map((call) =>
        typeof call[1].body === 'string'
          ? JSON.parse(call[1].body).method
          : 'upload',
      ),
    ).toEqual(['getLead', 'editLead', 'upload', 'getLead', 'upload'])
    expect(fetcher.mock.calls[4][1].body.get('file').type).toBe('image/jpeg')
  })
  it('rejects a wrong advertiser before any CRM write', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        rpc({ ...lead, primaryAccount: { name: 'Another advertiser' } }),
      )
    vi.stubGlobal('fetch', fetcher)
    await expect(attachMockup(42, image, 'credentials')).rejects.toThrow(
      'does not match',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('refuses to send credentials to a foreign upload origin', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      rpc({
        ...lead,
        file: [{ ...reserved, uri: 'https://attacker.example/file/api/8' }],
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(attachMockup(42, image, 'credentials')).rejects.toThrow(
      'Invalid Nutshell',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
