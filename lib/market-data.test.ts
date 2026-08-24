import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMocks = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  return { insert, values, onConflictDoUpdate }
})

vi.mock('server-only', () => ({}))
vi.mock('@/db', () => ({ db: { insert: databaseMocks.insert } }))
vi.mock('@/db/schema', () => ({
  billboardLocations: {
    city: 'city',
    state: 'state',
    embedding: 'embedding',
  },
}))

import {
  fetchLatestMarketData,
  isMarketDataSyncTime,
  parseMarketDataCsv,
  syncLatestMarketData,
} from './market-data'

const header = [
  'City',
  'State',
  'County',
  'Avg Daily Views',
  '4-Wk Range',
  'Market',
  'Market Range',
  'General Range',
  'Details',
  'Avg Bull Price/Mo',
  'Avg Stat Bull Views/Wk',
  'Avg Poster Price/Mo',
  'Avg Poster Views/Wk',
  'Avg Digital Price/Mo',
  'Avg Digital Views/Wk',
  'Avg Views/Period',
].join(',')

const row = (county: string, bullPrice: string) =>
  [
    'Austin',
    'TX',
    county,
    '1000',
    '$1-$2',
    'AUS',
    '$2-$3',
    '$3-$4',
    'Market details',
    bullPrice,
    '2000',
    '300',
    '4000',
    '500',
    '6000',
    '7000',
  ].join(',')

describe('market data sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs at 11 PM Central during standard and daylight saving time', () => {
    expect(isMarketDataSyncTime(new Date('2026-01-12T05:00:00Z'))).toBe(true)
    expect(isMarketDataSyncTime(new Date('2026-01-12T04:00:00Z'))).toBe(false)
    expect(isMarketDataSyncTime(new Date('2026-08-24T04:00:00Z'))).toBe(true)
    expect(isMarketDataSyncTime(new Date('2026-08-24T05:00:00Z'))).toBe(false)
  })

  it('parses the provider CSV and keeps the last duplicate city/state row', () => {
    const result = parseMarketDataCsv(
      `${header}\n${row('Travis', '100')}\n${row('Williamson', '200')}\n`,
    )

    expect(result.sourceRecordCount).toBe(2)
    expect(result.duplicateRecordCount).toBe(1)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      city: 'Austin',
      state: 'TX',
      county: 'Williamson',
      avgBullPricePerMonth: 200,
    })
  })

  it('rejects CSV output that does not match the provider contract', () => {
    expect(() => parseMarketDataCsv('City,State\nAustin,TX\n')).toThrow(
      'Market data CSV is missing columns',
    )
  })

  it('fetches CSV with the configured bearer token', async () => {
    const fetchData = vi.fn().mockResolvedValue(
      new Response(`${header}\n${row('Travis', '100')}\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      }),
    )

    const result = await fetchLatestMarketData('dialogs-key', fetchData)

    expect(result.records).toHaveLength(1)
    expect(fetchData).toHaveBeenCalledWith(
      'https://geopoepoe.com/api-get-market-data?format=csv',
      expect.objectContaining({
        headers: {
          Accept: 'text/csv',
          Authorization: 'Bearer dialogs-key',
        },
      }),
    )
  })

  it('upserts the fetched records', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(`${header}\n${row('Travis', '100')}\n`),
    )
    const generateEmbeddings = vi.fn().mockResolvedValue([[0.1, 0.2]])

    const result = await syncLatestMarketData(
      'dialogs-key',
      'openai-key',
      generateEmbeddings,
    )

    expect(result).toEqual({
      sourceRecordCount: 1,
      syncedRecordCount: 1,
      duplicateRecordCount: 0,
    })
    expect(generateEmbeddings).toHaveBeenCalledWith([
      expect.stringContaining('City: Austin'),
    ])
    expect(databaseMocks.insert).toHaveBeenCalledOnce()
    expect(databaseMocks.values).toHaveBeenCalledWith([
      expect.objectContaining({
        city: 'Austin',
        state: 'TX',
        embedding: [0.1, 0.2],
      }),
    ])
    expect(databaseMocks.onConflictDoUpdate).toHaveBeenCalledOnce()
  })
})
